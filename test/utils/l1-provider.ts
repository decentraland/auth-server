import { AuthChain, AuthLinkType } from '@dcl/schemas'

/** What an ERC-1271 account answers from `isValidSignature` when it accepts the signature. */
const ERC1271_MAGIC_VALUE = '0x1626ba7e' + '0'.repeat(56)

type RpcPayload = { id: number; method: string; params?: unknown[] }
type RpcCallback = (error: Error | null, response?: unknown) => void

/**
 * A `sendAsync` for the mock L1 provider that answers `eth_call` as an ERC-1271 account would:
 * accepting the signature, or rejecting it.
 */
export const contractAccountThat =
  (verdict: 'accepts' | 'rejects') =>
  (payload: RpcPayload, callback: RpcCallback): void => {
    if (payload.method === 'eth_getBlockByNumber') {
      const latest = payload.params?.[0] === 'latest'
      callback(null, {
        id: payload.id,
        jsonrpc: '2.0',
        result: { number: latest ? '0x64' : '0x1', timestamp: latest ? '0x' + (Math.floor(Date.now() / 1000) - 12).toString(16) : '0x1' }
      })
      return
    }
    if (payload.method === 'eth_blockNumber') {
      callback(null, { id: payload.id, jsonrpc: '2.0', result: '0x64' })
      return
    }
    if (payload.method !== 'eth_call') {
      callback(new Error(`Unexpected RPC method ${payload.method}`))
      return
    }
    callback(null, { id: payload.id, jsonrpc: '2.0', result: verdict === 'accepts' ? ERC1271_MAGIC_VALUE : '0x' + '0'.repeat(64) })
  }

/**
 * The same chain, with its ephemeral link marked as signed by an account with code behind it. The
 * link type is what routes a chain to the on-chain (ERC-1271) check, so no contract is needed.
 */
export const asContractAccountChain = (authChain: AuthChain): AuthChain => [
  ...authChain.slice(0, -1),
  { ...authChain[authChain.length - 1], type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL }
]
