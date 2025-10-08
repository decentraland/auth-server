import { IStorageComponent, StorageRequest, StorageIdentity } from './types'

export function createStorageComponent(): IStorageComponent {
  const requests: Record<string, StorageRequest> = {}
  const requestIdsBySocketId: Record<string, string> = {}
  const identitiesById: Record<string, StorageIdentity> = {}

  const getRequest = (requestId: string) => {
    return requests[requestId] ?? null
  }

  const setRequest = (requestId: string, request: StorageRequest | null) => {
    if (request) {
      if (request.socketId) {
        const previousSocketRequestId = requestIdsBySocketId[request.socketId]

        if (previousSocketRequestId) {
          delete requests[previousSocketRequestId]
          delete requestIdsBySocketId[request.socketId]
        }

        requestIdsBySocketId[request.socketId] = requestId
      }
      requests[requestId] = request
    } else {
      const previousRequest = requests[requestId]

      if (previousRequest) {
        delete requests[requestId]
        if (previousRequest.socketId) {
          delete requestIdsBySocketId[previousRequest.socketId]
        }
      }
    }
  }

  const getRequestIdForSocketId = (socketId: string) => {
    return requestIdsBySocketId[socketId] ?? null
  }

  const getIdentity = (identityId: string) => {
    return identitiesById[identityId] ?? null
  }

  const setIdentity = (identityId: string, identityData: StorageIdentity | null) => {
    if (identityData) {
      identitiesById[identityId] = identityData
    }
  }

  const deleteIdentity = (identityId: string) => {
    delete identitiesById[identityId]
  }

  return {
    getRequest,
    setRequest,
    getRequestIdForSocketId,
    getIdentity,
    setIdentity,
    deleteIdentity
  }
}
