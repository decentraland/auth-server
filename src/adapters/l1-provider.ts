import { FetchFunction, HTTPProvider } from 'eth-connect'
import type { IConfigComponent } from '@well-known-components/interfaces'

const DEFAULT_ETH_RPC_URL = 'https://rpc.decentraland.org/mainnet?project=auth-server'
const DEFAULT_RPC_TIMEOUT_IN_MILLISECONDS = 5_000

/**
 * Ethereum provider used to validate signatures from accounts with code behind them: contract
 * wallets, and EOAs delegated to one through EIP-7702. Those sign under ERC-1271, which can only be
 * checked by calling the account on chain. Plain EOA signatures are still verified offline and never
 * reach it.
 *
 * `HTTPProvider` handles a failed request, but not a response whose body cannot be read, so the body
 * is read and parsed here, under a deadline: every failure then surfaces as a rejected request.
 */
export async function createL1Provider(
  { config }: { config: IConfigComponent },
  { timeoutInMilliseconds = DEFAULT_RPC_TIMEOUT_IN_MILLISECONDS }: { timeoutInMilliseconds?: number } = {}
): Promise<HTTPProvider> {
  const url = (await config.getString('ETH_RPC_URL')) || DEFAULT_ETH_RPC_URL

  const fetchJsonRpc: FetchFunction = async (input, params) => {
    const response = await fetch(input, { ...params, signal: AbortSignal.timeout(timeoutInMilliseconds) } as RequestInit)

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { ok: false, status: response.status }
    }

    const body: unknown = JSON.parse(await response.text())
    if (typeof body !== 'object' || body === null) {
      throw new Error('Invalid JSON-RPC response')
    }

    return { ok: true, status: response.status, json: async () => body }
  }

  return new HTTPProvider(url, { fetch: fetchJsonRpc })
}
