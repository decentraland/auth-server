import { RequestAlreadyHasResponseError, RequestExpiredError, loadActiveRequest } from '../../logic/requests'
import { AppComponents } from '../../types'
import { OutcomeResponseMessage } from '../server/types'
import { IStorageComponent, StorageRequest, StorageIdentity, IdentityStatus } from './types'

const REQUESTS_CACHE_KEY_PREFIX = 'request:'
const OUTCOME_CACHE_KEY_PREFIX = 'request-outcome:'
const OUTCOME_CLAIM_KEY_PREFIX = 'request-outcome-claim:'
const REQUEST_IDS_BY_SOCKET_ID_CACHE_KEY_PREFIX = 'requestIdsBySocketId:'
const IDENTITIES_BY_ID_CACHE_KEY_PREFIX = 'identity:'
const IDENTITY_STATUS_CACHE_KEY_PREFIX = 'identity-status:'
const DID_TOKEN_ID_CACHE_KEY_PREFIX = 'magic-did-tid:'
const TWO_WEEKS_IN_SECONDS = 14 * 24 * 60 * 60

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

/** Creates cache-backed request storage, including single-writer outcome reservation. */
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
      // Separate, write-once outcome storage prevents a concurrent validation update (which
      // writes an older request snapshot) from erasing or replacing the accepted answer.
      response: (await cache.get<OutcomeResponseMessage>(`${OUTCOME_CACHE_KEY_PREFIX}${requestId}`)) ?? raw.response,
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

  const recordOutcome = async (
    requestId: string,
    outcome: OutcomeResponseMessage,
    authorizationExpiresAt: number
  ): Promise<StorageRequest> => {
    const request = await loadActiveRequest({ getRequest, setRequest }, requestId, { rejectIfHasResponse: true })
    const remainingMs = request.expiration.getTime() - Date.now()
    if (remainingMs <= 0 || authorizationExpiresAt <= Date.now()) throw new RequestExpiredError(requestId)
    // One attempt, using the shared cache's atomic lock primitive (Redis SET NX in production).
    // Keep this claim until request expiry. Never release it after a failed/uncertain write:
    // accepting another answer could overwrite an outcome whose write actually succeeded.
    const claimed = await cache.tryAcquireLock(`${OUTCOME_CLAIM_KEY_PREFIX}${requestId}`, {
      ttlInMilliseconds: Math.ceil(remainingMs),
      retries: 1
    })
    if (!claimed) throw new RequestAlreadyHasResponseError(requestId)
    const current = await loadActiveRequest({ getRequest, setRequest }, requestId, { rejectIfHasResponse: true })
    if (authorizationExpiresAt <= Date.now() || current.expiration.getTime() <= Date.now()) throw new RequestExpiredError(requestId)
    await cache.set(`${OUTCOME_CACHE_KEY_PREFIX}${requestId}`, outcome, secondsUntilExpiration(current.expiration))
    return { ...current, response: outcome }
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

  const getIdentityStatusCacheKey = (identityId: string) => {
    return `${IDENTITY_STATUS_CACHE_KEY_PREFIX}${identityId}`
  }

  const getIdentityStatus = async (identityId: string): Promise<IdentityStatus | null> => {
    const raw = await cache.get<IdentityStatus>(getIdentityStatusCacheKey(identityId))
    if (!raw) return null
    return {
      ...raw,
      expiration: toDate(raw.expiration),
      createdAt: toDate(raw.createdAt)
    }
  }

  const setIdentityStatus = async (identityId: string, status: IdentityStatus): Promise<void> => {
    await cache.set(getIdentityStatusCacheKey(identityId), status, TWO_WEEKS_IN_SECONDS)
  }

  const updateIdentityStatus = async (identityId: string, updates: Partial<IdentityStatus>): Promise<void> => {
    const existing = await getIdentityStatus(identityId)
    if (!existing) return
    await cache.set(getIdentityStatusCacheKey(identityId), { ...existing, ...updates }, TWO_WEEKS_IN_SECONDS)
  }

  const consumeDidTokenId = async (tid: string, ttlSeconds: number): Promise<boolean> => {
    const key = `${DID_TOKEN_ID_CACHE_KEY_PREFIX}${tid}`
    const existing = await cache.get<boolean>(key)
    if (existing) {
      return false
    }
    await cache.set(key, true, Math.max(1, Math.ceil(ttlSeconds)))
    return true
  }

  return {
    getRequest,
    setRequest,
    recordOutcome,
    getRequestIdForSocketId,
    getIdentity,
    setIdentity,
    deleteIdentity,
    getIdentityStatus,
    setIdentityStatus,
    updateIdentityStatus,
    consumeDidTokenId
  }
}
