import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import type { ISignatureValidatorAdapter, ValidationCaller } from '../adapters/signature-validator'

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
 * A chain signed by an account with code behind it — a contract wallet, or an EOA delegated
 * through EIP-7702 — cannot be settled here: ERC-1271 needs the account itself to be asked on
 * chain. Those go to `signatureValidator`, which defers to the Catalyst. Passing `null` to
 * `Authenticator.validateSignature` for them is what made every such login fail with
 * `Missing provider`. An ordinary EOA signature still verifies offline and never leaves the box.
 *
 * `caller` says whose budget such a call draws from — see `ValidationCaller`. It is unused for a
 * chain that verifies offline.
 */
export async function validateAuthChain(
  authChain: AuthChain,
  signatureValidator: ISignatureValidatorAdapter,
  caller: ValidationCaller
): Promise<{ sender: string; finalAuthority: string }> {
  if (!authChain.length) {
    throw new Error('Auth chain is required')
  }

  const sender = Authenticator.ownerAddress(authChain)

  let finalAuthority: string
  let expiration: number

  try {
    const ephemeralPayload = parseEmphemeralPayload(authChain[authChain.length - 1].payload)

    finalAuthority = ephemeralPayload.ephemeralAddress
    expiration = ephemeralPayload.expiration
  } catch (e) {
    if (e instanceof Error && e.message === 'Ephemeral payload has expired') {
      throw e
    }
    throw new Error('Could not get final authority from auth chain')
  }

  let validationResult: { ok: boolean; message?: string }

  if (signatureValidator.requiresOnChainValidation(authChain)) {
    // The offline path gets its expiry check from `Authenticator.validateSignature`, and the
    // parser above only rejects an expired payload on some versions of `@dcl/crypto` — not the
    // one pinned here. So the on-chain path has no backstop before the chain leaves the box, and
    // an expired one would spend a Catalyst call to be told what is already known here. These
    // chains arrive on unauthenticated endpoints, so that is free amplification: settle it
    // locally. Nothing the Catalyst would have accepted is rejected, since it runs the same check.
    if (expiration < Date.now()) {
      throw new Error('Ephemeral payload has expired')
    }

    validationResult = await signatureValidator.validateOnChain(authChain, finalAuthority, caller)
  } else {
    validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)
  }

  if (!validationResult.ok) {
    throw new Error(validationResult.message ?? 'Signature validation failed')
  }

  return { sender, finalAuthority }
}
