import { createHash } from 'crypto'

/** Header the client sends on `GET /identities/:id` carrying the secret its `authRequestId` was derived from. */
export const IDENTITY_VERIFIER_HEADER = 'x-identity-verifier'

// base64url (no padding) of 32 random bytes.
const VERIFIER_REGEX = /^[A-Za-z0-9_-]{43}$/

/**
 * Derives the UUID v4 a client uses as its `authRequestId` from its secret verifier: the first 16 bytes
 * of SHA-256(verifier) with the version/variant bits set. Returns null when the verifier is malformed.
 */
export function deriveAuthRequestId(verifier: string): string | null {
  if (!VERIFIER_REGEX.test(verifier)) {
    return null
  }

  const bytes = createHash('sha256').update(verifier, 'ascii').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Whether the verifier proves possession of the secret behind the stored `authRequestId`. */
export function isValidIdentityVerifier(verifier: string, authRequestId: string): boolean {
  return deriveAuthRequestId(verifier) === authRequestId.toLowerCase()
}
