import { InvalidResponseMessage, RecoverMessage, RecoverResponseMessage } from '../../../ports/server/types'
import { validateRecoverMessage } from '../../../ports/server/validations'
import { isErrorWithMessage } from '../../error-handling'
import { SocketHandlerContext } from '../types'

// RECOVER — returns a previously-registered, still-valid request by id.
export async function recoverSocketHandler(context: SocketHandlerContext, data: unknown) {
  const {
    components: { storage, logs }
  } = context
  const logger = logs.getLogger('websocket-server')

  logger.log('Received a recover request')

  let msg: RecoverMessage
  try {
    msg = validateRecoverMessage(data)
  } catch (e) {
    logger.log('Received a recover request with invalid message')
    return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
  }

  const request = await storage.getRequest(msg.requestId)

  if (!request) {
    logger.log(`[RID:${msg.requestId}] Received a recover request for a non-existent request`)
    return { error: `Request with id "${msg.requestId}" not found` } satisfies InvalidResponseMessage
  }

  if (request.fulfilled) {
    logger.log(`[RID:${msg.requestId}] Received a recover request for an already fulfilled request`)
    return { error: `Request with id "${msg.requestId}" has already been fulfilled` } satisfies InvalidResponseMessage
  }

  if (request.expiration < new Date()) {
    await storage.setRequest(msg.requestId, null)
    logger.log(`[RID:${msg.requestId}] Received a recover request for an expired request`)
    return { error: `Request with id "${msg.requestId}" has expired` } satisfies InvalidResponseMessage
  }

  logger.log(`[METHOD:${request.method}][RID:${request.requestId}][EXP:${request.expiration.getTime()}] Successfully recovered request`)

  return {
    expiration: request.expiration,
    code: request.code,
    method: request.method,
    params: request.params,
    sender: request.sender
  } satisfies RecoverResponseMessage
}
