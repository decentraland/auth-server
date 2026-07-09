import { InvalidResponseMessage, MessageType, OutcomeMessage, OutcomeResponseMessage } from '../../../ports/server/types'
import { validateOutcomeMessage } from '../../../ports/server/validations'
import { StorageRequest } from '../../../ports/storage/types'
import { isErrorWithMessage } from '../../error-handling'
import { loadActiveRequest, logInboundRequestStateError, RequestStateError } from '../../requests'
import { SocketHandlerContext } from '../types'

// OUTCOME — records the outcome of a request and relays it to the waiting client, or persists it
// for polling via GET /requests/:requestId when the client's socket is gone.
export async function outcomeSocketHandler(context: SocketHandlerContext, data: unknown) {
  const {
    components: { storage },
    logger,
    emitToSocket,
    isSocketConnected
  } = context

  let msg: OutcomeMessage
  try {
    msg = validateOutcomeMessage(data)
  } catch (e) {
    logger.log('Received an outcome message with invalid message')
    return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
  }

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, msg.requestId, { rejectIfHasResponse: true })
  } catch (e) {
    if (e instanceof RequestStateError) {
      logInboundRequestStateError(logger, msg.requestId, 'an outcome message', e)
      return { error: e.message } satisfies InvalidResponseMessage
    }
    throw e
  }

  const outcomeMessage: OutcomeResponseMessage = msg

  // If it has a socketId and the socket is still connected, send via socket.
  // Otherwise, store the response for polling via GET /requests/:requestId.
  if (request.socketId && isSocketConnected(request.socketId)) {
    // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
    await storage.setRequest(msg.requestId, {
      requestId: msg.requestId,
      socketId: request.socketId,
      fulfilled: true,
      expiration: request.expiration,
      code: 0,
      method: '',
      params: [],
      requiresValidation: false
    })

    emitToSocket(request.socketId, MessageType.OUTCOME, outcomeMessage)
    logger.log(
      `[METHOD:${request.method}][RID:${
        request.requestId
      }][EXP:${request.expiration.getTime()}] Successfully sent outcome message to the client`
    )
  } else {
    // Socket gone or HTTP-created request — persist response for polling
    await storage.setRequest(msg.requestId, {
      ...request,
      response: outcomeMessage
    })
    logger.log(
      `[METHOD:${request.method}][RID:${
        request.requestId
      }][EXP:${request.expiration.getTime()}] Stored outcome for polling (socket unavailable)`
    )
  }

  return {}
}
