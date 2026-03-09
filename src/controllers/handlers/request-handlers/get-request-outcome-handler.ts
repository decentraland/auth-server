import type { InvalidResponseMessage, OutcomeResponseMessage } from '../../../ports/server/types'
import type { HandlerContextWithPath } from '../../types'

export async function getRequestOutcomeHandler({
  components: { logs, requestOperations, storage },
  params
}: HandlerContextWithPath<'logs' | 'requestOperations' | 'storage', '/requests/:requestId'>) {
  const logger = logs.getLogger('http-server')
  const { requestId } = params

  const request = await storage.getRequest(requestId)

  if (!request) {
    return {
      status: 404,
      body: {
        error: `Request with id "${requestId}" not found`
      } satisfies InvalidResponseMessage
    }
  }

  if (request.fulfilled) {
    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has already been fulfilled`
      } satisfies InvalidResponseMessage
    }
  }

  if (requestOperations.isRequestExpired(request)) {
    await storage.deleteRequest(requestId)
    return {
      status: 404,
      body: {
        error: `Request with id "${requestId}" has expired`
      } satisfies InvalidResponseMessage
    }
  }

  if (!request.response) {
    return {
      status: 204
    }
  }

  logger.log(`[RID:${requestId}] Successfully sent outcome message to the client via HTTP`)

  await storage.setRequest(
    requestId,
    requestOperations.toFulfilledRequestRecord({
      requestId,
      expiration: request.expiration
    })
  )

  return {
    status: 200,
    body: request.response satisfies OutcomeResponseMessage
  }
}
