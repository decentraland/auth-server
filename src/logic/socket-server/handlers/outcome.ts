import { InvalidResponseMessage, MessageType, OutcomeMessage, OutcomeResponseMessage } from '../../../ports/server/types'
import { validateOutcomeMessage } from '../../../ports/server/validations'
import { isErrorWithMessage } from '../../error-handling'
import { SocketHandlerContext } from '../types'

// OUTCOME — records the outcome of a request and relays it to the waiting client, or persists it
// for polling via GET /requests/:requestId when the client's socket is gone.
export async function outcomeSocketHandler(context: SocketHandlerContext, data: unknown) {
  const {
    components: { storage, logs },
    emitToSocket,
    isSocketConnected
  } = context
  const logger = logs.getLogger('websocket-server')

  let msg: OutcomeMessage
  try {
    msg = validateOutcomeMessage(data)
  } catch (e) {
    logger.log('Received an outcome message with invalid message')
    return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
  }

  const request = await storage.getRequest(msg.requestId)

  if (!request) {
    logger.log(`[RID:${msg.requestId}] Received an outcome message for a non-existent request`)
    return { error: `Request with id "${msg.requestId}" not found` } satisfies InvalidResponseMessage
  }

  if (request.fulfilled) {
    logger.log(`[RID:${msg.requestId}] Received an outcome message for an already fulfilled request`)
    return { error: `Request with id "${msg.requestId}" has already been fulfilled` } satisfies InvalidResponseMessage
  }

  if (request.response) {
    logger.log(`[RID:${msg.requestId}] Received an outcome message for a request that already has a response`)
    return { error: `Request with id "${msg.requestId}" already has a response` } satisfies InvalidResponseMessage
  }

  if (request.expiration < new Date()) {
    await storage.setRequest(msg.requestId, null)
    logger.log(`[RID:${msg.requestId}] Received an outcome message for an expired request`)
    return { error: `Request with id "${msg.requestId}" has expired` } satisfies InvalidResponseMessage
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
