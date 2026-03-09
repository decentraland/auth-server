import type { InvalidResponseMessage, RecoverResponseMessage } from '../../../ports/server/types'
import { getPathParam } from '../../helpers'
import type { HandlerContextWithPath } from '../../types'

export async function getRequestHandler({
  components: { requestOperations, storage },
  params
}: HandlerContextWithPath<'requestOperations' | 'storage', '/v2/requests/:requestId'>) {
  const requestId = getPathParam(params.requestId)

  if (!requestId) {
    return {
      status: 400,
      body: {
        error: 'Invalid requestId path param'
      } satisfies InvalidResponseMessage
    }
  }

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
    await storage.setRequest(requestId, null)

    return {
      status: 410,
      body: {
        error: `Request with id "${requestId}" has expired`
      } satisfies InvalidResponseMessage
    }
  }

  return {
    status: 200,
    body: requestOperations.toRecoverResponse(request) satisfies RecoverResponseMessage
  }
}
