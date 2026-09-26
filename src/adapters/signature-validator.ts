import type { IFetchComponent } from '@dcl/core-commons'
import { AuthLinkType } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'

export type ISignatureValidatorAdapter = {
  /**
   * Whether this auth chain carries a signature that cannot be verified offline.
   */
  requiresOnChainValidation(authChain: AuthChain): boolean
  /**
   * Validates such a chain, resolving to the reason when it is not valid.
   */
  validateOnChain(authChain: AuthChain, finalAuthority: string): Promise<{ ok: boolean; message?: string }>
}

/**
 * Link types whose signature belongs to an account with code behind it, and can only be checked by
 * asking that account on chain (ERC-1271). Everything else verifies with `ecrecover`, offline.
 */
const ON_CHAIN_LINK_TYPES: AuthLinkType[] = [AuthLinkType.ECDSA_EIP_1654_EPHEMERAL, AuthLinkType.ECDSA_EIP_1654_SIGNED_ENTITY]

const DEFAULT_PEER_URL = 'https://peer.decentraland.org'
const DEFAULT_TIMEOUT_IN_MILLISECONDS = 5000

/**
 * Validates the auth chains this service cannot verify on its own.
 *
 * Most chains are signed by a plain EOA and `@dcl/crypto` settles them offline. An account with
 * code behind it — a contract wallet, or an EOA that delegated to one through EIP-7702, which is
 * what Coinbase is migrating its users to — signs under ERC-1271 instead, and verifying that means
 * a call to the account on chain. Rather than give this service its own RPC endpoint and a
 * decision about which chain to query, it defers to the Catalyst, which already runs that
 * validation and exposes it. `builder-server` resolves the same problem the same way.
 */
export function createSignatureValidatorAdapter({
  config,
  fetch,
  logs
}: {
  config: IConfigComponent
  fetch: IFetchComponent
  logs: ILoggerComponent
}): ISignatureValidatorAdapter {
  const logger = logs.getLogger('signature-validator')
  let cachedPeerUrl: string | undefined
  let cachedTimeout: number | undefined

  async function getPeerUrl(): Promise<string> {
    cachedPeerUrl ??= (await config.getString('PEER_URL')) || DEFAULT_PEER_URL
    return cachedPeerUrl.replace(/\/+$/, '')
  }

  async function getTimeout(): Promise<number> {
    cachedTimeout ??= (await config.getNumber('PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS')) ?? DEFAULT_TIMEOUT_IN_MILLISECONDS
    return cachedTimeout
  }

  return {
    requiresOnChainValidation(authChain: AuthChain): boolean {
      return authChain.some(link => ON_CHAIN_LINK_TYPES.includes(link.type))
    },

    async validateOnChain(authChain: AuthChain, finalAuthority: string): Promise<{ ok: boolean; message?: string }> {
      const peerUrl = await getPeerUrl()
      const timeout = await getTimeout()

      try {
        // `timeout` is the fetch component's own option, not a fetch init field: it owns the
        // AbortController and overrides any `signal` passed alongside the request, so a
        // hand-rolled one would abort a controller nobody is listening to. A POST is not
        // idempotent, so the component makes a single attempt and this bounds the whole call —
        // a slow Catalyst fails one signature check rather than holding a login open.
        const response = await fetch.fetch(`${peerUrl}/lambdas/crypto/validate-signature`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ authChain, signedMessage: finalAuthority }),
          timeout
        })

        if (!response.ok) {
          // Drain the body so undici releases the socket back to the pool before returning.
          await response.body?.cancel().catch(() => undefined)
          return { ok: false, message: `Could not validate the signature on chain (${response.status})` }
        }

        const result = (await response.json()) as { valid?: boolean; error?: string }
        return result.valid ? { ok: true } : { ok: false, message: result.error ?? 'Signature validation failed' }
      } catch (error) {
        // Fail closed: an unverified signature is not an accepted one.
        logger.warn('Could not reach the Catalyst to validate a signature', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        return { ok: false, message: 'Could not validate the signature on chain' }
      }
    }
  }
}
