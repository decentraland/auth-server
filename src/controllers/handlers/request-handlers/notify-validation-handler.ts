import type { InvalidResponseMessage } from '../../../ports/server/types'
import { getPathParam } from '../../helpers'
import type { HandlerContext } from '../../types'

export async function notifyValidationHandler(ctx: HandlerContext<'/v2/requests/:requestId/validation'>) {
  const { components, params } = ctx
  const { logs, requestOperations, storage } = components
  const logger = logs.getLogger('http-server')
  const requestId = getPathParam(params.requestId)
  const request = await storage.getRequest(requestId)

  if (!request) {
    logger.log(`[RID:${requestId}] Received a validation request message for a non-existent request`)
    return {
      status: 404,
      body: {
        error: `Request with id "${requestId}" not found`
      } satisfies InvalidResponseMessage
    }
  }

  if (request.fulfilled) {
    logger.log(`[RID:${requestId}] Received a validation request message for an already fulfilled request`)
    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has already been fulfilled`
      } satisfies InvalidResponseMessage
    }
  }

  if (requestOperations.isRequestExpired(request)) {
    logger.log(`[RID:${requestId}] Received a validation request message for an expired request`)
    await storage.setRequest(requestId, null)

    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has expired`
      } satisfies InvalidResponseMessage
    }
  }

  request.requiresValidation = true
  await storage.setRequest(requestId, request)

  return {
    status: 204
  }
}
