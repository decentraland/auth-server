import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'

/**
 * Validates an auth chain and returns the owner address (`sender`) and the
 * ephemeral address (`finalAuthority`). Mirrors the validation used by the
 * socket `request` handler. Throws on any validation failure; the `Ephemeral
 * payload has expired` error is re-thrown verbatim so callers can surface the
 * upstream "expired" status.
 */
export async function validateAuthChain(authChain: AuthChain): Promise<{ sender: string; finalAuthority: string }> {
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

  const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

  if (!validationResult.ok) {
    throw new Error(validationResult.message ?? 'Signature validation failed')
  }

  return { sender, finalAuthority }
}
