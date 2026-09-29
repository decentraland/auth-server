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
const DEFAULT_MAX_CONCURRENT_VALIDATIONS = 10

/**
 * The same bound lamb2 enforces on `/lambdas/crypto/validate-signature`, for the same reason it
 * states there: real EIP-1654 chains are 2-5 links long, and capping keeps an unauthenticated
 * caller from amplifying one request into many `eth_call`s. A longer chain is answered upstream
 * with a 400 anyway, so refusing it here only spares the round trip.
 */
const MAX_AUTH_CHAIN_LENGTH = 10

/**
 * Validates the auth chains this service cannot verify on its own.
 *
 * Most chains are signed by a plain EOA and `@dcl/crypto` settles them offline. An account with
 * code behind it — a contract wallet, or an EOA that delegated to one through EIP-7702, which is
 * what Coinbase is migrating its users to — signs under ERC-1271 instead, and verifying that means
 * a call to the account on chain. Rather than give this service its own RPC endpoint and a
 * decision about which chain to query, it defers to the Catalyst, which already runs that
 * validation and exposes it. `builder-server` resolves the same problem the same way.
 *
 * `POST /requests` and the socket `request` event accept an auth chain from anyone, so this is the
 * one place where unauthenticated input turns into outbound traffic. Two bounds keep that from
 * becoming an availability problem for the logins this adapter exists to fix: chains longer than
 * the Catalyst would accept never leave the box, and no more than `PEER_VALIDATION_MAX_CONCURRENT`
 * validations are in flight at once — past that, a request is refused here rather than queued
 * behind a saturated upstream. Results are deliberately NOT cached: an account's ERC-1271 answer
 * changes when its owner rotates or its EIP-7702 delegation is revoked, so a cached `valid` could
 * outlive the authority it recorded.
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
  let cachedMaxConcurrent: number | undefined
  let inFlight = 0

  async function getPeerUrl(): Promise<string> {
    cachedPeerUrl ??= (await config.getString('PEER_URL')) || DEFAULT_PEER_URL
    return cachedPeerUrl.replace(/\/+$/, '')
  }

  async function getTimeout(): Promise<number> {
    cachedTimeout ??= (await config.getNumber('PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS')) ?? DEFAULT_TIMEOUT_IN_MILLISECONDS
    return cachedTimeout
  }

  async function getMaxConcurrent(): Promise<number> {
    cachedMaxConcurrent ??= (await config.getNumber('PEER_VALIDATION_MAX_CONCURRENT')) ?? DEFAULT_MAX_CONCURRENT_VALIDATIONS
    return cachedMaxConcurrent
  }

  return {
    requiresOnChainValidation(authChain: AuthChain): boolean {
      return authChain.some(link => ON_CHAIN_LINK_TYPES.includes(link.type))
    },

    async validateOnChain(authChain: AuthChain, finalAuthority: string): Promise<{ ok: boolean; message?: string }> {
      if (authChain.length > MAX_AUTH_CHAIN_LENGTH) {
        return { ok: false, message: `Auth chain length must be between 1 and ${MAX_AUTH_CHAIN_LENGTH}` }
      }

      // Every value this call needs is resolved before the slot is taken, so the check and the
      // increment below run in one synchronous block and the cap cannot be raced past.
      const peerUrl = await getPeerUrl()
      const timeout = await getTimeout()
      const maxConcurrent = await getMaxConcurrent()

      if (inFlight >= maxConcurrent) {
        logger.warn('Refused to validate a signature on chain: too many validations in flight', { inFlight, maxConcurrent })
        return { ok: false, message: 'Could not validate the signature on chain' }
      }

      inFlight++

      // The deadline is owned here rather than handed to the fetch component, whose own `timeout`
      // stops at the response headers: it clears its timer as soon as `fetch` resolves, leaving a
      // stalled body unbounded by anything but undici's 300s default. Aborting from this
      // controller covers the body too, and the timer is cleared once the body is parsed, so a
      // fast response is never aborted. A POST is not idempotent, so the component makes a single
      // attempt and this bounds the whole call.
      const abortController = new AbortController()
      const timer = setTimeout(() => abortController.abort(), timeout)

      try {
        const response = await fetch.fetch(`${peerUrl}/lambdas/crypto/validate-signature`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ authChain, signedMessage: finalAuthority }),
          abortController
        })

        if (!response.ok) {
          logger.warn('The Catalyst could not validate a signature', { status: response.status })
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
      } finally {
        clearTimeout(timer)
        inFlight--
      }
    }
  }
}
