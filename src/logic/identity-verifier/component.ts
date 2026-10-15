import { createHash } from 'crypto'
import { AppComponents } from '../../types'
import { InvalidIdentityVerifierError } from './errors'
import { IIdentityVerifierComponent } from './types'

/** Header the client sends on `GET /identities/:id` carrying the secret its `authRequestId` was derived from. */
export const IDENTITY_VERIFIER_HEADER = 'x-identity-verifier'

// base64url (no padding) of 32 random bytes.
const VERIFIER_REGEX = /^[A-Za-z0-9_-]{43}$/

// First 16 bytes of SHA-256(verifier) with the UUID v4 version/variant bits set, or null when malformed.
function deriveAuthRequestId(verifier: string): string | null {
  if (!VERIFIER_REGEX.test(verifier)) {
    return null
  }

  const bytes = createHash('sha256').update(verifier, 'ascii').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Creates the component that checks the deep-link sign-in verifier on identity retrieval.
 *
 * Reads `REQUIRE_IDENTITY_VERIFIER` once: while it is not `true`, a missing verifier is allowed so
 * Explorer builds that predate it keep working through the caller's IP check.
 *
 * @param components - `config`, to read `REQUIRE_IDENTITY_VERIFIER`.
 * @returns The identity verifier component.
 */
export async function createIdentityVerifierComponent({ config }: Pick<AppComponents, 'config'>): Promise<IIdentityVerifierComponent> {
  const requireVerifier = (await config.getString('REQUIRE_IDENTITY_VERIFIER')) === 'true'

  function verifyRetrieval(authRequestId: string | undefined, verifier: string | null): boolean {
    if (!authRequestId) {
      return false
    }

    if (!verifier) {
      if (requireVerifier) {
        throw new InvalidIdentityVerifierError('missing')
      }
      return false
    }

    if (deriveAuthRequestId(verifier) !== authRequestId.toLowerCase()) {
      throw new InvalidIdentityVerifierError('invalid')
    }

    return true
  }

  return { verifyRetrieval }
}
