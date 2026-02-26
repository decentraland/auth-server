import { isErrorWithMessage } from '../../../logic/error-handling'
import type { HttpOutcomeMessage, InvalidResponseMessage } from '../../../ports/server/types'
import { getJsonBody, getRequiredPathParam } from '../../helpers'
import type { HandlerContext } from '../../types'
import { validateHttpOutcomeMessage } from '../../validations'

export async function submitOutcomeHandler(ctx: HandlerContext<'/v2/requests/:requestId/outcome'>) {
  const { components, params } = ctx
  const { logs, requestOperations, storage } = components
  const logger = logs.getLogger('http-server')
  const requestId = getRequiredPathParam(params.requestId, 'requestId')

  let msg: HttpOutcomeMessage

  try {
    msg = validateHttpOutcomeMessage(await getJsonBody(ctx))
  } catch (error) {
    return {
      status: 400,
      body: {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      } satisfies InvalidResponseMessage
    }
  }

  const request = await storage.getRequest(requestId)

  if (!request) {
    logger.log(`[RID:${requestId}] Received an outcome message for a non-existent request`)
    return {
      status: 404,
      body: {
        error: `Request with id "${requestId}" not found`
      } satisfies InvalidResponseMessage
    }
  }

  if (request.fulfilled) {
    logger.log(`[RID:${requestId}] Received an outcome message for an already fulfilled request`)
    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has already been fulfilled`
      } satisfies InvalidResponseMessage
    }
  }

  if (request.response) {
    logger.log(`[RID:${requestId}] Received an outcome message for a request that already has a response`)
    return {
      status: 400,
      body: {
        error: `Request with id "${requestId}" already has a response`
      } satisfies InvalidResponseMessage
    }
  }

  if (requestOperations.isRequestExpired(request)) {
    // This cleanup is intentionally idempotent; concurrent expired submissions may call it more than once.
    await storage.setRequest(requestId, null)
    logger.log(`[RID:${requestId}] Received an outcome message for an expired request`)
    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has expired`
      } satisfies InvalidResponseMessage
    }
  }

  const outcomeMessage = requestOperations.toOutcomeResponse(requestId, msg)
  await storage.setRequest(requestId, requestOperations.toPollingOutcomeRecord(request, outcomeMessage))
  logger.log(`[METHOD:${request.method}][RID:${request.requestId}][EXP:${request.expiration.getTime()}] Stored outcome for polling`)

  return {
    status: 200
  }
}
