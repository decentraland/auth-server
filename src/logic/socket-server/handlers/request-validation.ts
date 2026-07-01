import { InvalidResponseMessage, MessageType, RequestValidationMessage } from '../../../ports/server/types'
import { validateRequestValidationMessage } from '../../../ports/server/validations'
import { isErrorWithMessage } from '../../error-handling'
import { SocketHandlerContext } from '../types'

// REQUEST_VALIDATION_STATUS — marks a request as requiring validation and notifies the waiting client.
export async function requestValidationSocketHandler(context: SocketHandlerContext, data: unknown) {
  const {
    components: { storage },
    logger,
    emitToSocket,
    isSocketConnected
  } = context

  let msg: RequestValidationMessage
  try {
    msg = validateRequestValidationMessage(data)
  } catch (e) {
    logger.log('Received a request validation message with invalid data')
    return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
  }

  const request = await storage.getRequest(msg.requestId)

  if (!request) {
    logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it doesn't exist`)
    return { error: `Request with id "${msg.requestId}" not found` } satisfies InvalidResponseMessage
  }

  if (request.fulfilled) {
    logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has already been fulfilled`)
    return { error: `Request with id "${msg.requestId}" has already been fulfilled` } satisfies InvalidResponseMessage
  }

  if (request.expiration < new Date()) {
    await storage.setRequest(msg.requestId, null)
    logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has expired`)
    return { error: `Request with id "${msg.requestId}" has expired` } satisfies InvalidResponseMessage
  }

  if (request.socketId && isSocketConnected(request.socketId) && !request.requiresValidation) {
    // Relay the request validation to the client
    emitToSocket(request.socketId, MessageType.REQUEST_VALIDATION_STATUS, { requestId: msg.requestId, code: request.code })
  }

  request.requiresValidation = true

  return {}
}
