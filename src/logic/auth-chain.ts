import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import type { HTTPProvider } from 'eth-connect'

/**
 * Deadline for validating one auth chain. Checking an ERC-1271 signature can take several RPC calls
 * in sequence, each with its own timeout, so the whole check is bounded as well.
 */
const SIGNATURE_VALIDATION_TIMEOUT_IN_MILLISECONDS = 15_000

/**
 * Whether `value` is a Decentraland ephemeral message — the payload whose signature mints an auth
 * identity, and what the removed `dcl_personal_sign` flow asked wallets to sign. Signing one over
 * any other method (`personal_sign`, `eth_sign`, …) reproduces that flow exactly, so requests
 * carrying such a payload are refused while ordinary signing stays allowed.
 *
 * Detection delegates to `@dcl/crypto`'s own parser so it cannot drift from the format the
 * ephemeral auth links are validated against. That parser ignores the first line and only requires
 * the `Ephemeral address:` / `Expiration:` lines, which is why matching the "Decentraland Login"
 * greeting would not be enough — any greeting yields a usable ephemeral link.
 */
export function isEphemeralMessage(value: string): boolean {
  return isEphemeralMessageText(value) || isEphemeralMessageText(decodeHexMessage(value))
}

function isEphemeralMessageText(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  try {
    parseEmphemeralPayload(value)
    return true
  } catch (e) {
    // An expired payload is still an ephemeral message; the parser rejects it on some versions.
    return e instanceof Error && e.message === 'Ephemeral payload has expired'
  }
}

/**
 * `personal_sign` takes its message hex-encoded as often as it takes plain text, so a hex payload
 * has to be decoded before it can be recognised.
 */
function decodeHexMessage(value: string): string | undefined {
  if (!/^0x[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  return Buffer.from(value.slice(2), 'hex').toString('utf8')
}

/**
 * Validates an auth chain and returns the owner address (`sender`) and the
 * ephemeral address (`finalAuthority`). Mirrors the validation used by the
 * socket `request` handler. Throws on any validation failure; the `Ephemeral
 * payload has expired` error is re-thrown verbatim so callers can surface the
 * upstream "expired" status.
 *
 * `l1Provider` is only used for signatures from accounts with code behind them (ERC-1271), which
 * have to be checked on chain; EOA signatures are verified offline.
 */
export async function validateAuthChain(
  authChain: AuthChain,
  l1Provider: HTTPProvider
): Promise<{ sender: string; finalAuthority: string }> {
  if (!authChain.length) {
    throw new Error('Auth chain is required')
  }

  const sender = Authenticator.ownerAddress(authChain)

  let finalAuthority: string

  try {
    const ephemeralPayload = parseEmphemeralPayload(authChain[authChain.length - 1].payload)

    finalAuthority = ephemeralPayload.ephemeralAddress
  } catch (e) {
    if (e instanceof Error && e.message === 'Ephemeral payload has expired') {
      throw e
    }
    throw new Error('Could not get final authority from auth chain')
  }

  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Signature validation timed out')), SIGNATURE_VALIDATION_TIMEOUT_IN_MILLISECONDS)
  })

  const validationResult = await Promise.race([Authenticator.validateSignature(finalAuthority, authChain, l1Provider), deadline]).finally(
    () => clearTimeout(timer)
  )

  if (!validationResult.ok) {
    throw new Error(validationResult.message ?? 'Signature validation failed')
  }

  return { sender, finalAuthority }
}
