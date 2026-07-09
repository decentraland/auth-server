import { InvalidResponseMessage, MessageType, RequestValidationMessage } from '../../../ports/server/types'
import { validateRequestValidationMessage } from '../../../ports/server/validations'
import { StorageRequest } from '../../../ports/storage/types'
import { isErrorWithMessage } from '../../error-handling'
import {
  loadActiveRequest,
  RequestAlreadyFulfilledError,
  RequestExpiredError,
  RequestNotFoundError,
  RequestStateError
} from '../../requests'
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

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, msg.requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      if (e instanceof RequestNotFoundError) {
        logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it doesn't exist`)
      } else if (e instanceof RequestAlreadyFulfilledError) {
        logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has already been fulfilled`)
      } else if (e instanceof RequestExpiredError) {
        logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has expired`)
      }
      return { error: e.message } satisfies InvalidResponseMessage
    }
    throw e
  }

  if (request.socketId && isSocketConnected(request.socketId) && !request.requiresValidation) {
    // Relay the request validation to the client
    emitToSocket(request.socketId, MessageType.REQUEST_VALIDATION_STATUS, { requestId: msg.requestId, code: request.code })
  }

  // Persist the flag: storage.getRequest returns a copy, so mutating `request` alone would be lost.
  request.requiresValidation = true
  await storage.setRequest(msg.requestId, request)

  return {}
}
