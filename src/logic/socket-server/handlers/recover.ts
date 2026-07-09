import { InvalidResponseMessage, RecoverMessage, RecoverResponseMessage } from '../../../ports/server/types'
import { validateRecoverMessage } from '../../../ports/server/validations'
import { StorageRequest } from '../../../ports/storage/types'
import { isErrorWithMessage } from '../../error-handling'
import { loadActiveRequest, logInboundRequestStateError, RequestStateError } from '../../requests'
import { SocketHandlerContext } from '../types'

// RECOVER — returns a previously-registered, still-valid request by id.
export async function recoverSocketHandler(context: SocketHandlerContext, data: unknown) {
  const {
    components: { storage },
    logger
  } = context

  logger.log('Received a recover request')

  let msg: RecoverMessage
  try {
    msg = validateRecoverMessage(data)
  } catch (e) {
    logger.log('Received a recover request with invalid message')
    return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
  }

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, msg.requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      logInboundRequestStateError(logger, msg.requestId, 'a recover request', e)
      return { error: e.message } satisfies InvalidResponseMessage
    }
    throw e
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
