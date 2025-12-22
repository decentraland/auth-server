import { AppComponents } from '../../types'
import { IStorageComponent, StorageRequest, StorageIdentity } from './types'

const REQUESTS_CACHE_KEY_PREFIX = 'request:'
const REQUEST_IDS_BY_SOCKET_ID_CACHE_KEY_PREFIX = 'requestIdsBySocketId:'
const IDENTITIES_BY_ID_CACHE_KEY_PREFIX = 'identity:'

export function createStorageComponent({ cache }: Pick<AppComponents, 'cache'>): IStorageComponent {
  const getRequestCacheKey = (requestId: string) => {
    return `${REQUESTS_CACHE_KEY_PREFIX}${requestId}`
  }

  const getRequestIdsBySocketIdCacheKey = (socketId: string) => {
    return `${REQUEST_IDS_BY_SOCKET_ID_CACHE_KEY_PREFIX}${socketId}`
  }

  const getIdentityCacheKey = (identityId: string) => {
    return `${IDENTITIES_BY_ID_CACHE_KEY_PREFIX}${identityId}`
  }

  const getRequest = (requestId: string): Promise<StorageRequest | null> => {
    return cache.get<StorageRequest>(getRequestCacheKey(requestId)) ?? null
  }

  const setRequest = async (requestId: string, request: StorageRequest | null): Promise<void> => {
    if (request) {
      if (request.socketId) {
        const previousSocketRequestId = (await cache.get<string>(getRequestIdsBySocketIdCacheKey(request.socketId))) ?? null

        if (previousSocketRequestId) {
          await cache.remove(getRequestCacheKey(previousSocketRequestId))
          await cache.remove(getRequestIdsBySocketIdCacheKey(request.socketId))
        }

        await cache.set(getRequestIdsBySocketIdCacheKey(request.socketId), requestId)
      }
      await cache.set(getRequestCacheKey(requestId), request)
    } else {
      const previousRequest = (await cache.get<StorageRequest>(getRequestCacheKey(requestId))) ?? null

      if (previousRequest) {
        await cache.remove(getRequestCacheKey(requestId))
        if (previousRequest.socketId) {
          await cache.remove(getRequestIdsBySocketIdCacheKey(previousRequest.socketId))
        }
      }
    }
  }

  const getRequestIdForSocketId = async (socketId: string): Promise<string | null> => {
    return (await cache.get<string>(getRequestIdsBySocketIdCacheKey(socketId))) ?? null
  }

  const getIdentity = async (identityId: string): Promise<StorageIdentity | null> => {
    return (await cache.get<StorageIdentity>(getIdentityCacheKey(identityId))) ?? null
  }

  const setIdentity = async (identityId: string, identityData: StorageIdentity | null): Promise<void> => {
    if (identityData) {
      await cache.set(getIdentityCacheKey(identityId), identityData)
    }
  }

  const deleteIdentity = async (identityId: string): Promise<void> => {
    await cache.remove(getIdentityCacheKey(identityId))
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
