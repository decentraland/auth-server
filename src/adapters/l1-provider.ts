import type { IConfigComponent } from '@well-known-components/interfaces'

const DEFAULT_ETH_RPC_URL = 'https://rpc.decentraland.org/mainnet?project=auth-server'
const DEFAULT_RPC_TIMEOUT_IN_MILLISECONDS = 5_000
const MAX_ERROR_MESSAGE_LENGTH = 200

type JsonRpcRequest = { id: number | string; jsonrpc?: string; method: string; params?: unknown[] }
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: number | string; result: unknown }
  | { jsonrpc: '2.0'; id: number | string; error: { code: number; message: string } }
type Callback = (error: Error | null, response?: JsonRpcResponse) => void

/**
 * The provider interface `@dcl/crypto` drives: one JSON-RPC request per `sendAsync` call.
 */
export type IL1Provider = {
  sendAsync(payload: JsonRpcRequest, callback: Callback): void
}

/**
 * Ethereum provider used to validate signatures from accounts with code behind them: contract
 * wallets, and EOAs delegated to one through EIP-7702. Those sign under ERC-1271, which can only be
 * checked by calling the account on chain. Plain EOA signatures are still verified offline and never
 * reach it.
 *
 * Each request is bounded by a deadline that covers the response body. Whatever the RPC answers is
 * reduced to a well-formed JSON-RPC response before it is handed on, so any failure — an error
 * status, an unreadable or malformed body, a timeout — is reported through the callback as an error
 * rather than escaping from it.
 */
export async function createL1Provider(
  { config }: { config: IConfigComponent },
  { timeoutInMilliseconds = DEFAULT_RPC_TIMEOUT_IN_MILLISECONDS }: { timeoutInMilliseconds?: number } = {}
): Promise<IL1Provider> {
  const url = (await config.getString('ETH_RPC_URL')) || DEFAULT_ETH_RPC_URL

  async function call(payload: JsonRpcRequest, signal: AbortSignal): Promise<JsonRpcResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, jsonrpc: '2.0' }),
      signal
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`RPC request failed with status ${response.status}`)
    }

    return toJsonRpcResponse(payload.id, JSON.parse(await response.text()))
  }

  return {
    sendAsync(payload, callback) {
      const signal = AbortSignal.timeout(timeoutInMilliseconds)
      call(payload, signal).then(
        response => deliver(callback, null, response),
        error => {
          const reason = signal.aborted ? 'RPC request timed out' : error instanceof Error ? error.message : 'RPC request failed'
          deliver(callback, new Error(reason))
        }
      )
    }
  }
}

/**
 * Keeps only what a JSON-RPC response is allowed to carry: the request's id, and either a result or
 * an error with a string message. Anything else is rejected as invalid.
 */
function toJsonRpcResponse(id: JsonRpcRequest['id'], body: unknown): JsonRpcResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Invalid JSON-RPC response')
  }

  const { error, result } = body as { error?: unknown; result?: unknown }

  // `error: null` is how some RPCs say there is none.
  if (error !== undefined && error !== null) {
    const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown }
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: typeof code === 'number' ? code : -32603,
        message: typeof message === 'string' ? message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : 'JSON-RPC error'
      }
    }
  }

  const isExpectedResult = typeof result === 'string' || (typeof result === 'object' && result !== null && !Array.isArray(result))
  if (!isExpectedResult) {
    throw new Error('Invalid JSON-RPC response')
  }

  return { jsonrpc: '2.0', id, result }
}

/**
 * The callback belongs to the caller and runs its own handling of the response synchronously. A
 * throw from it is contained here: the request then never settles, and the caller's deadline ends it.
 */
function deliver(callback: Callback, error: Error | null, response?: JsonRpcResponse): void {
  try {
    callback(error, response)
  } catch {
    // Nothing to recover: the caller's own deadline rejects the validation.
  }
}
