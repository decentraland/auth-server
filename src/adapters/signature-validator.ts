import type { IFetchComponent } from '@dcl/core-commons'
import { Authenticator, AuthLinkType } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import type { metricDeclarations } from '../metrics'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'

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
 * The shape a login actually produces: a `SIGNER` link naming the account, followed by the
 * ephemeral link that account signed. `isEIP1654AuthChain` in `@dcl/crypto-middleware` applies the
 * same rule, so this is the shape the rest of the platform accepts too.
 *
 * Checking it costs nothing and is a much tighter bound than a length cap: a forged chain still
 * has to look like a login to reach the Catalyst at all. Nothing legitimate is turned away —
 * `validateAuthChain` already requires the last link to parse as an ephemeral payload, so no other
 * shape can reach this adapter in the first place.
 */
function isSmartAccountLoginChain(authChain: AuthChain): boolean {
  return (
    (authChain.length === 2 || authChain.length === 3) &&
    authChain[0].type === AuthLinkType.SIGNER &&
    authChain[1].type === AuthLinkType.ECDSA_EIP_1654_EPHEMERAL
  )
}

/**
 * Reads a bound from config, rejecting a value that would disable what it bounds. `0` is the one
 * that matters: it is not nullish, so it survives `??`, and it would mean "abort every call" for
 * the timeout and "refuse every call" for the cap.
 */
async function readPositiveInteger(config: IConfigComponent, name: string, fallback: number): Promise<number> {
  const value = await config.getNumber(name)

  if (value === undefined) {
    return fallback
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Configuration: config "${name}" should be a positive integer, got ${value} instead`)
  }

  return value
}

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
 * one place where unauthenticated input turns into outbound traffic. Three bounds keep that from
 * becoming an availability problem for the logins this adapter exists to fix: a chain that is not
 * shaped like a login never leaves the box, an expired one is settled by the caller, and no more
 * than `PEER_VALIDATION_MAX_CONCURRENT` validations are in flight at once — past that a request is
 * refused here rather than queued behind a saturated upstream. Results are deliberately NOT
 * cached: an account's ERC-1271 answer changes when its owner rotates or its EIP-7702 delegation
 * is revoked, so a cached `valid` could outlive the authority it recorded.
 *
 * Config is resolved and checked here rather than on first use, so a bad `PEER_URL` or bound fails
 * at boot instead of surfacing as a 400 on some user's login.
 */
export async function createSignatureValidatorAdapter({
  config,
  fetch,
  logs,
  metrics
}: {
  config: IConfigComponent
  fetch: IFetchComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
}): Promise<ISignatureValidatorAdapter> {
  const logger = logs.getLogger('signature-validator')

  const peerUrl = ((await config.getString('PEER_URL')) || DEFAULT_PEER_URL).replace(/\/+$/, '')
  const timeout = await readPositiveInteger(config, 'PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS', DEFAULT_TIMEOUT_IN_MILLISECONDS)
  const maxConcurrent = await readPositiveInteger(config, 'PEER_VALIDATION_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT_VALIDATIONS)
  const validateSignatureUrl = `${peerUrl}/lambdas/crypto/validate-signature`

  // Logged so the values actually in force are visible at boot. `PEER_VALIDATION_...=5s` parses as
  // `5` rather than failing, and a 5ms deadline is otherwise only noticeable as every
  // smart-account login being turned away.
  logger.log(`Validating on-chain signatures against ${validateSignatureUrl}`, { timeout, maxConcurrent })

  let inFlight = 0

  return {
    requiresOnChainValidation(authChain: AuthChain): boolean {
      return authChain.some(link => ON_CHAIN_LINK_TYPES.includes(link.type))
    },

    async validateOnChain(authChain: AuthChain, finalAuthority: string): Promise<{ ok: boolean; message?: string }> {
      if (!isSmartAccountLoginChain(authChain)) {
        metrics.increment('signature_validation_refused_total', { reason: 'invalid_shape' })
        return { ok: false, message: 'Auth chain is not shaped like a login' }
      }

      // Nothing is awaited between the check and the increment, so the cap cannot be raced past.
      if (inFlight >= maxConcurrent) {
        logger.warn('Refused to validate a signature on chain: too many validations in flight', { inFlight, maxConcurrent })
        metrics.increment('signature_validation_refused_total', { reason: 'cap_reached' })
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
        const response = await fetch.fetch(validateSignatureUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ authChain, signedMessage: finalAuthority }),
          abortController
        })

        if (!response.ok) {
          logger.warn('The Catalyst could not validate a signature', { status: response.status })
          metrics.increment('signature_validation_refused_total', { reason: 'upstream_status' })
          // Drain the body so undici releases the socket back to the pool before returning.
          await response.body?.cancel().catch(() => undefined)
          return { ok: false, message: `Could not validate the signature on chain (${response.status})` }
        }

        const result = (await response.json()) as { valid?: unknown; ownerAddress?: unknown; error?: unknown }

        // The same three checks `verifyEIP1654Sign` makes in `@dcl/crypto-middleware`. `PEER_URL`
        // is configurable, so a misrouted or misbehaving peer answering `{"valid":"false"}` must
        // not read as valid, and an answer about a different account must not settle this one.
        const isValid =
          result.valid === true &&
          typeof result.ownerAddress === 'string' &&
          result.ownerAddress.toLowerCase() === Authenticator.ownerAddress(authChain).toLowerCase()

        // `error` comes from a configurable peer and ends up in a 400 body, so it is only passed
        // on when it is actually a string — otherwise `new Error(obj)` upstream would render it as
        // `[object Object]`.
        return isValid
          ? { ok: true }
          : { ok: false, message: typeof result.error === 'string' ? result.error : 'Signature validation failed' }
      } catch (error) {
        // Fail closed: an unverified signature is not an accepted one.
        logger.warn('Could not reach the Catalyst to validate a signature', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        metrics.increment('signature_validation_refused_total', { reason: 'unreachable' })
        return { ok: false, message: 'Could not validate the signature on chain' }
      } finally {
        clearTimeout(timer)
        inFlight--
      }
    }
  }
}
