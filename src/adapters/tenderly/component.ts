import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { TenderlyAuthError, TenderlyBadRequestError, TenderlyRateLimitError, TenderlyUnavailableError } from './errors'
import { ITenderlyAdapter, TenderlyAssetChange, TenderlyRawLog, TenderlySimulateParams, TenderlySimulationResult } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The collections a successful preview is built from; a success that lacks one is a partial answer. */
const EFFECT_COLLECTIONS: ReadonlySet<string> = new Set(['logs', 'asset_changes'])

/**
 * A quantity the preview depends on exactly (a raw amount, a token id): an unsigned EVM integer. Absent, a
 * canonical decimal or `0x` hexadecimal string, or a non-negative number a double holds exactly. A larger
 * number has already been rounded by the JSON parse, and a sign, a fraction, an exponent, spaces or an empty
 * string are not an unsigned integer, so any of those can only be refused.
 */
const UNSIGNED_INTEGER_STRING = /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/
const isExactQuantity = (value: unknown): boolean =>
  value == null ||
  (typeof value === 'string' && UNSIGNED_INTEGER_STRING.test(value)) ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)

/** A raw EVM log as the decoders read it: string address and data, string topics. */
const isRawLog = (value: unknown): value is TenderlyRawLog =>
  isRecord(value) &&
  typeof value.address === 'string' &&
  typeof value.data === 'string' &&
  Array.isArray(value.topics) &&
  value.topics.every(topic => typeof topic === 'string')

const DEFAULT_API_URL = 'https://api.tenderly.co'
const DEFAULT_TIMEOUT_MS = 6000
/**
 * Upper bound on the entries of any collection a preview is built from. A response past it is refused,
 * never read short: these collections are the whole record of what the call does — the logs are the only
 * source of approvals and ERC-1155 movements, and every one of them is reconciled against Tenderly's own
 * rows — so a prefix would preview fewer effects than the call has, which is the one thing this service
 * must never do. The caller sees no preview and an acknowledgment saying so, which is honest; a truncated
 * preview that looked complete would not be.
 *
 * The bound also caps the work one request can ask for. Normalizing is linear in the entry count and runs
 * on the event loop, so an unbounded response lets one crafted call (a contract looping on `emit`) stall
 * every other request the process is serving.
 *
 * 512 against what real calls emit: the recorded fixtures are 0, 1 and 7 logs, the last being a wearable
 * purchase through the off-chain marketplace with three asset changes. The heaviest legitimate shape is a
 * batch transfer, at one or two logs per token. So this is ~70x the busiest flow measured and covers a
 * 256-token batch; a batch larger than that loses its preview and is acknowledged instead.
 */
const MAX_COLLECTION_ENTRIES = 512

/**
 * Upper bound on the response body read from Tenderly. The collection caps bound the work of
 * *normalizing* an answer; they cannot bound the work of *receiving* one, because the body is parsed
 * before there are any collections to count. A caller picks the transaction, so a caller picks how large
 * a trace comes back, and buffering and parsing an unbounded body is synchronous work on the event loop
 * whatever is decided about it afterwards.
 *
 * 8 MB against what a reportable answer weighs: the heaviest recorded fixture costs ~2.7 KB per log, so
 * both effect collections at their 512-entry cap project to ~1.7 MB, and the rest of the response is a
 * fraction of that again. Anything past this could not have been reported in full anyway, so refusing it
 * unread costs nothing a caller was going to be shown.
 */
const MAX_RESPONSE_BODY_BYTES = 8 * 1024 * 1024

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

  /**
   * The body as text, without ever buffering more than the bound. A declared length past it is refused
   * without reading a byte; otherwise the stream is cancelled the moment the bound is passed, so an
   * upstream that streams without announcing a length cannot make this process hold the whole thing.
   */
  const readBoundedBody = async (response: Response): Promise<string> => {
    const refuse = async () => {
      await response.body?.cancel().catch(() => undefined)
      throw new TenderlyUnavailableError(`Tenderly returned a body larger than ${MAX_RESPONSE_BODY_BYTES} bytes`)
    }
    const declared = Number(response.headers?.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BODY_BYTES) {
      return refuse()
    }
    const reader = response.body?.getReader?.()
    if (!reader) {
      // Every real response has a readable body; one without it cannot be read short, so it is refused
      // rather than read by some other route that the bound would not cover.
      throw new TenderlyUnavailableError('Tenderly returned a body that cannot be read')
    }
    const decoder = new TextDecoder()
    const chunks: string[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new TenderlyUnavailableError(`Tenderly returned a body larger than ${MAX_RESPONSE_BODY_BYTES} bytes`)
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  }

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

    // Read under the bound first, then parse: `response.json()` would buffer and parse the whole body
    // before anything could refuse it (see MAX_RESPONSE_BODY_BYTES).
    const body = await readBoundedBody(response)
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
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

    // The status is what tells a successful preview from a reverting one, and it must be said outright: a
    // response without a boolean status has no preview to show, whatever else it carries. Defaulting to
    // success would render an empty "no changes" summary for a call whose outcome is unknown, and reading a
    // revert reason as a status would let any error string stand in for one, so both are treated like every
    // other unusable upstream answer.
    if (typeof transaction.status !== 'boolean') {
      throw new TenderlyUnavailableError('Tenderly returned no transaction status')
    }
    const reverted = transaction.status === false

    // A revert reports no effects whatever the trace carries, so nothing past the reason is read: a revert
    // with unreadable trace metadata is still the "likely to fail" preview, never an outage.
    if (reverted) {
      logger.log(`Tenderly simulation ok (to=${to}, networkId=${networkId}, status=false)`)
      return {
        status: false,
        errorMessage,
        assetChanges: [],
        exposureChanges: [],
        rawLogs: [],
        balanceChanges: [],
        events: []
      }
    }

    // The effects live in `transaction_info`. A response without it, without the collections the preview is
    // built from (`logs`, `asset_changes`), or whose collections or entries are not what the schema says,
    // would read as a success with no effects or crash the normalization, so it is refused: an absent field
    // is a partial answer, while a collection Tenderly reports as null is its empty collection and is accepted
    // as such. The two enrichment collections (`exposure_changes`, `balance_changes`) may be absent.
    const transactionInfo = transaction.transaction_info
    if (!isRecord(transactionInfo)) {
      throw new TenderlyUnavailableError('Tenderly returned no transaction info')
    }
    const collections: Record<'logs' | 'asset_changes' | 'exposure_changes' | 'balance_changes', Record<string, unknown>[]> = {
      logs: [],
      asset_changes: [],
      exposure_changes: [],
      balance_changes: []
    }
    for (const collection of Object.keys(collections) as Array<keyof typeof collections>) {
      const value = transactionInfo[collection]
      if (value === undefined) {
        if (EFFECT_COLLECTIONS.has(collection)) {
          throw new TenderlyUnavailableError(`Tenderly returned no ${collection} collection`)
        }
        continue
      }
      if (value === null) continue
      if (!Array.isArray(value)) {
        throw new TenderlyUnavailableError(`Tenderly returned a malformed ${collection} collection`)
      }
      // The length first, before anything walks the entries: every check below is linear in the entry
      // count, so reading it after them would let an oversized array cost a full pass to be thrown away
      // (see MAX_COLLECTION_ENTRIES).
      if (value.length > MAX_COLLECTION_ENTRIES) {
        throw new TenderlyUnavailableError(
          `Tenderly returned more than ${MAX_COLLECTION_ENTRIES} ${collection} entries, more than a preview can report`
        )
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

    // Passed through as reported, not normalized here: what counts as a display figure is the preview's
    // rule, and applying it in two places is how `dollar_value` came to be the one figure that escaped it.
    const balanceChanges = collections.balance_changes

    const events = collections.logs
      .map(log => ({
        name: typeof log.name === 'string' ? log.name : null,
        address: String((isRecord(log.raw) ? log.raw.address : '') ?? '').toLowerCase()
      }))
      .filter(event => event.address !== '')

    logger.log(`Tenderly simulation ok (to=${to}, networkId=${networkId}, status=true)`)

    return {
      status: true,
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
