import { AppComponents } from '../../types'
import { IStorageComponent, StorageRequest, StorageIdentity } from './types'

const REQUESTS_CACHE_KEY_PREFIX = 'request:'
const REQUEST_IDS_BY_SOCKET_ID_CACHE_KEY_PREFIX = 'requestIdsBySocketId:'
const IDENTITIES_BY_ID_CACHE_KEY_PREFIX = 'identity:'

/** Normalize cache value to Date (Redis/JSON returns string; in-memory may return Date). */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  return new Date()
}

/** TTL in seconds from now until expiration; minimum 1 so cache never gets 0 or negative. */
function secondsUntilExpiration(expiration: Date): number {
  return Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 1000))
}

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

  const getRequest = async (requestId: string): Promise<StorageRequest | null> => {
    const raw = await cache.get<StorageRequest>(getRequestCacheKey(requestId))
    if (!raw) return null
    return {
      ...raw,
      expiration: toDate(raw.expiration)
    }
  }

  const setRequest = async (requestId: string, request: StorageRequest | null): Promise<void> => {
    if (request) {
      const ttlSeconds = secondsUntilExpiration(request.expiration)
      if (request.socketId) {
        const previousSocketRequestId = (await cache.get<string>(getRequestIdsBySocketIdCacheKey(request.socketId))) ?? null

        if (previousSocketRequestId) {
          await cache.remove(getRequestCacheKey(previousSocketRequestId))
          await cache.remove(getRequestIdsBySocketIdCacheKey(request.socketId))
        }

        await cache.set(getRequestIdsBySocketIdCacheKey(request.socketId), requestId, ttlSeconds)
      }
      await cache.set(getRequestCacheKey(requestId), request, ttlSeconds)
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
    const raw = await cache.get<StorageIdentity>(getIdentityCacheKey(identityId))
    if (!raw) return null
    return {
      ...raw,
      expiration: toDate(raw.expiration),
      createdAt: toDate(raw.createdAt)
    }
  }

  const setIdentity = async (identityId: string, identityData: StorageIdentity | null): Promise<void> => {
    if (identityData) {
      const ttlSeconds = secondsUntilExpiration(identityData.expiration)
      await cache.set(getIdentityCacheKey(identityId), identityData, ttlSeconds)
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
