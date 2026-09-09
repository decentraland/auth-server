import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { TenderlyAuthError, TenderlyBadRequestError, TenderlyRateLimitError, TenderlyUnavailableError } from './errors'
import { ITenderlyAdapter, TenderlyAssetChange, TenderlyRawLog, TenderlySimulateParams, TenderlySimulationResult } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The collections a successful preview is built from; a success that lacks one is a partial answer. */
const EFFECT_COLLECTIONS: ReadonlySet<string> = new Set(['logs', 'asset_changes'])

/**
 * A quantity the preview depends on exactly (a raw amount, a token id): absent, a string, or a number a double
 * holds exactly. A larger number has already been rounded by the JSON parse, so it can only be refused.
 */
const isExactQuantity = (value: unknown): boolean =>
  value == null || typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))

/** A raw EVM log as the decoders read it: string address and data, string topics. */
const isRawLog = (value: unknown): value is TenderlyRawLog =>
  isRecord(value) &&
  typeof value.address === 'string' &&
  typeof value.data === 'string' &&
  Array.isArray(value.topics) &&
  value.topics.every(topic => typeof topic === 'string')

const DEFAULT_API_URL = 'https://api.tenderly.co'
const DEFAULT_TIMEOUT_MS = 6000
// Upper bound on decoded event logs returned, to keep the response payload small.
const MAX_EVENTS = 50

/**
 * Creates the Tenderly adapter — a thin, typed wrapper around Tenderly's
 * transaction simulation API.
 *
 * Orchestration:
 * 1. Reads the access key and account/project slugs from config (the key is
 *    sensitive and is never logged, nor is the transaction calldata).
 * 2. `simulate()` POSTs to `/api/v1/account/{account}/project/{project}/simulate`
 *    with a bounded timeout and maps HTTP outcomes to typed errors.
 * 3. On success it returns a narrowed raw subset of the response.
 *
 * @param components - `config`, `logs` and `fetch`.
 * @returns The Tenderly adapter.
 */
export async function createTenderlyAdapter({
  config,
  logs,
  fetch
}: Pick<AppComponents, 'config' | 'logs' | 'fetch'>): Promise<ITenderlyAdapter> {
  const logger = logs.getLogger('tenderly-adapter')

  // Access key is required and sensitive — never log it (nor the calldata `input`).
  const accessKey = await config.requireString('TENDERLY_ACCESS_KEY')
  const accountSlug = await config.requireString('TENDERLY_ACCOUNT_SLUG')
  const projectSlug = await config.requireString('TENDERLY_PROJECT_SLUG')
  const apiUrl = (await config.getString('TENDERLY_API_URL')) || DEFAULT_API_URL
  const timeoutMs = (await config.getNumber('TENDERLY_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS

  const baseUrl = apiUrl.replace(/\/+$/, '')
  const simulateUrl = `${baseUrl}/api/v1/account/${accountSlug}/project/${projectSlug}/simulate`

  const simulate = async (params: TenderlySimulateParams): Promise<TenderlySimulationResult> => {
    const { networkId, from, to, input, value } = params

    let response: Response
    try {
      response = await fetch.fetch(simulateUrl, {
        method: 'POST',
        headers: {
          'X-Access-Key': accessKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          network_id: networkId,
          from,
          to,
          input,
          value,
          // Simulate with zero gas price so the sender is never charged for gas. Decentraland
          // transactions are relayed as meta-transactions where the gas tank (relayer) pays,
          // and the `from` we simulate (the user) usually holds no native balance — without
          // this, Tenderly would report a spurious "insufficient funds for gas" revert.
          gas_price: '0',
          simulation_type: 'full',
          save: false,
          save_if_fails: false
        }),
        // Use the fetch component's own `timeout` (which arms an AbortController it controls).
        // A caller-supplied `signal` is overwritten by the component, so it would be a no-op here.
        timeout: timeoutMs
      })
    } catch (e) {
      // Network failure or a timeout abort thrown by the fetch component. Nothing to drain.
      logger.warn(
        `Tenderly simulation call failed (to=${to}, networkId=${networkId}): ${isErrorWithMessage(e) ? e.message : 'unknown error'}`
      )
      throw new TenderlyUnavailableError('Tenderly request failed or timed out')
    }

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      logger.error(`Tenderly rejected the access key (status ${response.status})`)
      throw new TenderlyAuthError(`Tenderly rejected the access key (${response.status})`)
    }

    if (response.status === 400 || response.status === 422) {
      await response.body?.cancel().catch(() => undefined)
      throw new TenderlyBadRequestError(`Tenderly rejected the simulation request (${response.status})`)
    }

    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined)
      throw new TenderlyRateLimitError('Tenderly simulation rate limit exceeded (429)')
    }

    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined)
      throw new TenderlyUnavailableError(`Tenderly is unavailable (${response.status})`)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new TenderlyUnavailableError(`Tenderly returned an unexpected status (${response.status})`)
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      throw new TenderlyUnavailableError('Tenderly returned a malformed response body')
    }
    if (!isRecord(parsed)) {
      throw new TenderlyUnavailableError('Tenderly returned a malformed response body')
    }

    // Tenderly returns 200 + a top-level `error` object for some invalid sims.
    if (isRecord(parsed.error)) {
      const message = String(parsed.error.message || parsed.error.slug || 'Tenderly rejected the simulation request')
      throw new TenderlyBadRequestError(message)
    }

    const transaction = parsed.transaction
    if (!isRecord(transaction)) {
      throw new TenderlyUnavailableError('Tenderly returned no transaction')
    }
    const errorInfo = isRecord(transaction.error_info) ? transaction.error_info : null
    const errorMessage = typeof errorInfo?.error_message === 'string' ? errorInfo.error_message : null

    // The status is what tells a successful preview from a reverting one. `false` is a revert, and so is
    // a response that omits the field but carries a revert reason (a Go-style `omitempty` would drop a
    // `false`). Anything else without a status has no preview to show: defaulting to success would render
    // an empty "no changes" summary for a call whose outcome is unknown, so it is treated like any other
    // unusable upstream answer.
    const reverted = transaction.status === false || (transaction.status === undefined && errorMessage !== null)
    if (transaction.status !== true && !reverted) {
      throw new TenderlyUnavailableError('Tenderly returned no transaction status')
    }

    // The effects live in `transaction_info`. A successful response without it, without the collections the
    // preview is built from (`logs`, `asset_changes`), or whose collections or entries are not what the schema
    // says, would read as a success with no effects or crash the normalization, so it is refused: an absent
    // field is a partial answer, while a collection Tenderly reports as null is its empty collection and is
    // accepted as such. The two enrichment collections (`exposure_changes`, `balance_changes`) may be absent.
    // A revert reports no effects whatever it carries, so it needs none of this.
    const transactionInfo = isRecord(transaction.transaction_info) ? transaction.transaction_info : null
    if (!reverted && !transactionInfo) {
      throw new TenderlyUnavailableError('Tenderly returned no transaction info')
    }
    const collections: Record<'logs' | 'asset_changes' | 'exposure_changes' | 'balance_changes', Record<string, unknown>[]> = {
      logs: [],
      asset_changes: [],
      exposure_changes: [],
      balance_changes: []
    }
    for (const collection of Object.keys(collections) as Array<keyof typeof collections>) {
      const value = transactionInfo?.[collection]
      if (value === undefined) {
        if (!reverted && EFFECT_COLLECTIONS.has(collection)) {
          throw new TenderlyUnavailableError(`Tenderly returned no ${collection} collection`)
        }
        continue
      }
      if (value === null) continue
      if (!Array.isArray(value)) {
        throw new TenderlyUnavailableError(`Tenderly returned a malformed ${collection} collection`)
      }
      // The entries are read as objects below; a null or primitive entry would fail there as a plain crash,
      // so it is refused here as the malformed answer it is.
      if (!value.every(isRecord)) {
        throw new TenderlyUnavailableError(`Tenderly returned a malformed ${collection} entry`)
      }
      // An asset change's raw amount and token id are what the preview compares and gates on; one that arrived
      // as a number beyond 2^53 has already lost digits and would preview a different quantity.
      if (collection === 'asset_changes' && !value.every(entry => isExactQuantity(entry.raw_amount) && isExactQuantity(entry.token_id))) {
        throw new TenderlyUnavailableError('Tenderly returned an asset change whose quantity cannot be read exactly')
      }
      collections[collection] = value
    }

    // A log's `raw` is what the approval and transfer decoders read, and the only source of approvals and
    // ERC1155 movements. An entry without it, or with one of another shape, cannot be told from an effect
    // that went unreported, so the response is refused rather than read short.
    const rawLogs: TenderlyRawLog[] = []
    for (const entry of collections.logs) {
      if (!isRawLog(entry.raw)) {
        throw new TenderlyUnavailableError('Tenderly returned a log without a readable raw form')
      }
      rawLogs.push(entry.raw)
    }

    const balanceChanges = collections.balance_changes
      .map(bc => ({
        address: String(bc.address ?? '').toLowerCase(),
        dollarValue: bc.dollar_value != null ? String(bc.dollar_value) : null
      }))
      .filter(bc => bc.address !== '')

    const events = collections.logs
      .map(log => ({
        name: typeof log.name === 'string' ? log.name : null,
        address: String((isRecord(log.raw) ? log.raw.address : '') ?? '').toLowerCase()
      }))
      .filter(event => event.address !== '')
      .slice(0, MAX_EVENTS)

    logger.log(`Tenderly simulation ok (to=${to}, networkId=${networkId}, status=${!reverted})`)

    return {
      status: !reverted,
      errorMessage,
      assetChanges: collections.asset_changes as unknown as TenderlyAssetChange[],
      exposureChanges: collections.exposure_changes,
      rawLogs,
      balanceChanges,
      events
    }
  }

  logger.log(`Tenderly adapter ready (apiUrl=${baseUrl}, account=${accountSlug}, project=${projectSlug})`)

  return { simulate }
}
