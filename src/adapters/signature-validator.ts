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
 * The largest delay `setTimeout` honours. Node clamps anything above it to 1ms and only prints a
 * `TimeoutOverflowWarning`, so a larger deadline would abort every call instead of waiting longer.
 */
const MAX_TIMER_DELAY_IN_MILLISECONDS = 2 ** 31 - 1

/**
 * Longest Catalyst `error` text passed on to clients. It is already public through lamb2, so this
 * is not about secrecy — it keeps a misbehaving peer from filling a 400 body with whatever it sent.
 */
const MAX_ERROR_MESSAGE_LENGTH = 200

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
 * Reads a bound from config, rejecting anything that would disable what it bounds.
 *
 * Read as a string on purpose: `config.getNumber` resolves through `parseFloat`, so `5s` comes
 * back as `5` — a 5ms deadline that aborts every call — rather than failing. Requiring digits
 * rejects that at boot. `0` matters for the same reason: it is not nullish, so it survives `??`,
 * and it means "abort every call" for the timeout and "refuse every call" for the cap.
 */
async function readPositiveInteger(
  config: IConfigComponent,
  name: string,
  fallback: number,
  max: number = Number.MAX_SAFE_INTEGER
): Promise<number> {
  const value = await config.getString(name)

  if (value === undefined || value === '') {
    return fallback
  }

  if (!/^\d+$/.test(value) || Number(value) === 0 || Number(value) > max) {
    throw new Error(`Configuration: config "${name}" should be a positive integer no larger than ${max}, got "${value}" instead`)
  }

  return Number(value)
}

/**
 * Reads the Catalyst's origin, refusing anything but `https`.
 *
 * The Catalyst's verdict is what admits a smart-account login, so the link it travels over is part
 * of the signature check: over plain `http` anyone able to tamper with the traffic could answer
 * `{"valid":true,"ownerAddress":<victim>}` and sign in as that account. Only the origin is kept,
 * the same way `@dcl/crypto-middleware` resolves its catalyst, so a stray path cannot redirect the
 * call elsewhere on the host.
 */
async function readPeerOrigin(config: IConfigComponent): Promise<string> {
  const value = (await config.getString('PEER_URL')) || DEFAULT_PEER_URL

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Configuration: config "PEER_URL" should be an absolute URL, got "${value}" instead`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Configuration: config "PEER_URL" should use https, got "${value}" instead`)
  }

  return url.origin
}

/**
 * Whether the peer's answer is a JSON object. A peer that is not a Catalyst can answer `null`, an
 * array or a bare string with a 200, and reading `.valid` off `null` would throw.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  const peerOrigin = await readPeerOrigin(config)
  const timeout = await readPositiveInteger(
    config,
    'PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS',
    DEFAULT_TIMEOUT_IN_MILLISECONDS,
    MAX_TIMER_DELAY_IN_MILLISECONDS
  )
  const maxConcurrent = await readPositiveInteger(config, 'PEER_VALIDATION_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT_VALIDATIONS)
  const validateSignatureUrl = `${peerOrigin}/lambdas/crypto/validate-signature`

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

        // Parsed on its own so a peer answering HTML, or JSON that is not an object, is metered as
        // a bad answer rather than as an unreachable Catalyst — the two point at different fixes.
        // An abort while reading the body is still a timeout, and is left to the outer `catch`.
        let result: unknown
        try {
          result = await response.json()
        } catch (error) {
          if (abortController.signal.aborted) {
            throw error
          }
          result = undefined
        }

        if (!isObject(result)) {
          logger.warn('The Catalyst answered something that is not a JSON object')
          metrics.increment('signature_validation_refused_total', { reason: 'invalid_response' })
          return { ok: false, message: 'Signature validation failed' }
        }

        // The same checks `verifyEIP1654Sign` makes in `@dcl/crypto-middleware`. `PEER_URL` is
        // configurable, so a misrouted or misbehaving peer answering `{"valid":"false"}` must not
        // read as valid, and an answer about a different account must not settle this one. These
        // are metered apart from a rejected signature: otherwise a peer pointed at the wrong chain
        // looks exactly like a wave of bad signatures.
        if (typeof result.valid !== 'boolean') {
          logger.warn('The Catalyst answered a shape this service does not recognise', { valid: typeof result.valid })
          metrics.increment('signature_validation_refused_total', { reason: 'invalid_response' })
          return { ok: false, message: 'Signature validation failed' }
        }

        if (!result.valid) {
          // `error` comes from a configurable peer and ends up in a 400 body, so it is only passed
          // on when it is actually a string — otherwise `new Error(obj)` upstream would render it
          // as `[object Object]`.
          return {
            ok: false,
            message: typeof result.error === 'string' ? result.error.slice(0, MAX_ERROR_MESSAGE_LENGTH) : 'Signature validation failed'
          }
        }

        const owner = Authenticator.ownerAddress(authChain).toLowerCase()

        if (typeof result.ownerAddress !== 'string' || result.ownerAddress.toLowerCase() !== owner) {
          logger.warn('The Catalyst validated a signature for a different account', { expected: owner })
          metrics.increment('signature_validation_refused_total', { reason: 'invalid_response' })
          return { ok: false, message: 'Signature validation failed' }
        }

        return { ok: true }
      } catch (error) {
        // Fail closed: an unverified signature is not an accepted one. A deadline abort is metered
        // apart from a connection failure: a slow Catalyst and a down one call for different fixes.
        const reason = abortController.signal.aborted ? 'timeout' : 'unreachable'
        logger.warn('Could not reach the Catalyst to validate a signature', {
          reason,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        metrics.increment('signature_validation_refused_total', { reason })
        return { ok: false, message: 'Could not validate the signature on chain' }
      } finally {
        clearTimeout(timer)
        inFlight--
      }
    }
  }
}
