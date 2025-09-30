import { IStorageComponent, StorageRequest, StorageIdentityId } from './types'

export function createStorageComponent(): IStorageComponent {
  const requests: Record<string, StorageRequest> = {}
  const requestIdsBySocketId: Record<string, string> = {}
  const identityIds: Record<string, StorageIdentityId> = {}

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

  const getIdentityId = (identityId: string) => {
    return identityIds[identityId] ?? null
  }

  const setIdentityId = (identityId: string, identityData: StorageIdentityId | null) => {
    if (identityData) {
      identityIds[identityId] = identityData
    } else {
      delete identityIds[identityId]
    }
  }

  const deleteIdentityId = (identityId: string) => {
    delete identityIds[identityId]
  }

  const deleteExpiredIdentityId = () => {
    const now = new Date()
    Object.keys(identityIds).forEach(identityId => {
      if (identityIds[identityId].expiration < now) {
        delete identityIds[identityId]
      }
    })
  }

  return {
    getRequest,
    setRequest,
    getRequestIdForSocketId,
    getIdentityId,
    setIdentityId,
    deleteIdentityId,
    deleteExpiredIdentityId
  }
}
