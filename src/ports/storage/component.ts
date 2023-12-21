import { IStorageComponent, Request } from './types'

export function createStorageComponent(): IStorageComponent {
  const requests: Record<string, Request> = {}
  const requestIdsBySocketId: Record<string, string> = {}

  const getRequest = (requestId: string) => {
    return requests[requestId] ?? null
  }

  const setRequest = (requestId: string, request: Request | null) => {
    if (request) {
      const previousSocketRequestId = requestIdsBySocketId[request.socketId]

      if (previousSocketRequestId) {
        delete requests[previousSocketRequestId]
        delete requestIdsBySocketId[request.socketId]
      }

      requests[requestId] = request
      requestIdsBySocketId[request.socketId] = requestId
    } else {
      const previousRequest = requests[requestId]

      if (previousRequest) {
        delete requests[requestId]
        delete requestIdsBySocketId[previousRequest.socketId]
      }
    }
  }

  const getRequestIdForSocketId = (socketId: string) => {
    return requestIdsBySocketId[socketId] ?? null
  }

  return {
    getRequest,
    setRequest,
    getRequestIdForSocketId
  }
}
