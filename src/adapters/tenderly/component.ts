import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { TenderlyAuthError, TenderlyBadRequestError, TenderlyRateLimitError, TenderlyUnavailableError } from './errors'
import { ITenderlyAdapter, TenderlyRawLog, TenderlySimulateParams, TenderlySimulationResult } from './types'

const DEFAULT_API_URL = 'https://api.tenderly.co'
const DEFAULT_TIMEOUT_MS = 6000

/** Shape of the Tenderly `/simulate` JSON response we consume (all fields best-effort). */
type TenderlyRawResponse = {
  error?: { slug?: string; message?: string } | null
  transaction?: {
    status?: boolean
    error_info?: { error_message?: string } | null
    transaction_info?: {
      asset_changes?: TenderlySimulationResult['assetChanges'] | null
      exposure_changes?: unknown[] | null
      logs?: Array<{ raw?: TenderlyRawLog }> | null
    } | null
  } | null
}

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
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      // Network failure or AbortError (timeout). Nothing to drain.
      logger.warn(`Tenderly simulation call failed (to=${to}, networkId=${networkId}): ${isErrorWithMessage(e) ? e.message : 'unknown error'}`)
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

    let json: TenderlyRawResponse
    try {
      json = (await response.json()) as TenderlyRawResponse
    } catch {
      throw new TenderlyUnavailableError('Tenderly returned a malformed response body')
    }

    // Tenderly returns 200 + a top-level `error` object for some invalid sims.
    if (json && typeof json === 'object' && json.error) {
      const message = json.error.message || json.error.slug || 'Tenderly rejected the simulation request'
      throw new TenderlyBadRequestError(message)
    }

    const transaction = json.transaction
    const transactionInfo = transaction?.transaction_info

    const rawLogs = (transactionInfo?.logs ?? [])
      .map(entry => entry.raw)
      .filter((raw): raw is TenderlyRawLog => Boolean(raw))

    logger.log(`Tenderly simulation ok (to=${to}, networkId=${networkId}, status=${transaction?.status ?? 'unknown'})`)

    return {
      status: transaction?.status ?? true,
      errorMessage: transaction?.error_info?.error_message ?? null,
      assetChanges: transactionInfo?.asset_changes ?? [],
      exposureChanges: transactionInfo?.exposure_changes ?? [],
      rawLogs
    }
  }

  logger.log(`Tenderly adapter ready (apiUrl=${baseUrl}, account=${accountSlug}, project=${projectSlug})`)

  return { simulate }
}
