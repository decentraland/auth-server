import { IStorageComponent, StorageRequest } from './types'

export function createStorageComponent(args: { clearRequestsInSeconds: number }): IStorageComponent {
  const requests: Record<string, StorageRequest> = {}
  const requestIdsBySocketId: Record<string, string> = {}

  // Clears expired requests every x amount of time.
  setInterval(() => {
    for (const key in requests) {
      if (Object.prototype.hasOwnProperty.call(requests, key)) {
        const request = requests[key]

        if (request.expiration.getTime() < Date.now()) {
          delete requests[key]
          delete requestIdsBySocketId[request.socketId]
        }
      }
    }
  }, args.clearRequestsInSeconds * 1000)

  const getRequest = (requestId: string) => {
    return requests[requestId] ?? null
  }

  const setRequest = (requestId: string, request: StorageRequest | null) => {
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
