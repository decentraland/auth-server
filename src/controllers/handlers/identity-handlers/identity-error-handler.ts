import type { ILoggerComponent } from '@well-known-components/interfaces'
import { isErrorWithMessage } from '../../../logic/error-handling'
import {
  EphemeralAddressMismatchError,
  EphemeralKeyExpiredError,
  EphemeralPrivateKeyMismatchError,
  RequestSenderMismatchError
} from '../../../logic/errors'
import type { InvalidResponseMessage } from '../../../ports/server/types'

type IdentityErrorResponse = { status: number; body: InvalidResponseMessage }

export function handleIdentityValidationError(
  error: unknown,
  logger: ILoggerComponent.ILogger,
  identitySender: string | undefined
): IdentityErrorResponse {
  if (error instanceof EphemeralKeyExpiredError) {
    logger.log(`Ephemeral key has expired for sender: ${identitySender ?? 'unknown'}`)
    return { status: 401, body: { error: error.message } }
  }

  if (error instanceof EphemeralAddressMismatchError) {
    logger.log(`Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender ?? 'unknown'}`)
    return { status: 403, body: { error: error.message } }
  }

  if (error instanceof RequestSenderMismatchError) {
    logger.log(`Request sender does not match identity owner (${identitySender ?? 'unknown'})`)
    return { status: 403, body: { error: error.message } }
  }

  if (error instanceof EphemeralPrivateKeyMismatchError) {
    logger.log(`Ephemeral private key does not match the provided address for sender: ${identitySender ?? 'unknown'}`)
    return { status: 403, body: { error: error.message } }
  }

  const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
  logger.log(`Received a request to create identity with invalid auth chain: ${errorMessage}`)
  return { status: 400, body: { error: errorMessage } }
}
