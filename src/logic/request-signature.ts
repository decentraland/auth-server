import { keccak256, toUtf8Bytes } from 'ethers'
import { Authenticator } from '@dcl/crypto'
import { REQUEST_SIGNATURE_MAX_AGE_MS, SIGNED_BODY_HASH_METADATA_KEY } from '../ports/server/constants'
import { ValidatedRequestMessage } from '../ports/server/types'

export type SignedRequestMessage = ValidatedRequestMessage & { timestamp: number }

/**
 * Builds the string a socket client signs with its ephemeral key: `method:params:timestamp`, lowercased.
 * `params` is re-serialized here, so clients must send the same compact JSON they signed.
 */
export function buildSignedRequestPayload(method: string, params: unknown[], timestamp: number): string {
  return `${method}:${JSON.stringify(params)}:${timestamp}`.toLowerCase()
}

export function isSignedRequestMessage(msg: ValidatedRequestMessage): msg is SignedRequestMessage {
  return typeof msg.timestamp === 'number'
}

/**
 * Verifies a socket request whose auth chain ends in a link signed over `method:params:timestamp`.
 * Returns the chain owner; throws when the signature is invalid or the timestamp is outside the window.
 */
export async function verifySignedRequestMessage(msg: SignedRequestMessage, now: number = Date.now()): Promise<{ sender: string }> {
  if (Math.abs(now - msg.timestamp) > REQUEST_SIGNATURE_MAX_AGE_MS) {
    throw new Error('Request signature has expired')
  }

  const payload = buildSignedRequestPayload(msg.method, msg.params, msg.timestamp)
  const result = await Authenticator.validateSignature(payload, msg.authChain, null, now)
  if (!result.ok) {
    throw new Error(result.message ?? 'Invalid request signature')
  }

  return { sender: Authenticator.ownerAddress(msg.authChain).toLowerCase() }
}

/**
 * Checks that a signed-fetch request's metadata carries the keccak256 of the exact body bytes received.
 * Throws when the hash is missing or differs, so a body cannot be swapped under valid headers.
 */
export function verifySignedBody(rawBody: string, authMetadata: Record<string, unknown> | undefined): void {
  const signedHash = authMetadata?.[SIGNED_BODY_HASH_METADATA_KEY]
  if (typeof signedHash !== 'string' || signedHash.toLowerCase() !== keccak256(toUtf8Bytes(rawBody))) {
    throw new Error('Request body does not match the signed metadata')
  }
}
