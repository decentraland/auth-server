import { ICacheStorageComponent } from '@dcl/core-commons'
import { createRateLimiterComponent } from '../../src/ports/rate-limiter/component'
import { IRateLimiterComponent, RateLimitOptions } from '../../src/ports/rate-limiter/types'

const BUCKET = 'simulations'
const KEY = '10.0.0.1'
const FIXED_NOW_MS = 1_000_000_000_000

/** Minimal Map-backed cache implementing the subset the limiter uses. */
function createMapCache(): ICacheStorageComponent {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    remove: jest.fn(async (key: string) => {
      store.delete(key)
    }),
    exists: jest.fn(async (key: string) => store.has(key))
  } as unknown as ICacheStorageComponent
}

describe('when consuming from the rate limiter', () => {
  let cache: ICacheStorageComponent
  let rateLimiter: IRateLimiterComponent
  let options: RateLimitOptions

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS)
    cache = createMapCache()
    rateLimiter = createRateLimiterComponent({ cache })
    options = { max: 3, windowSeconds: 60 }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and the number of requests is below the limit', () => {
    it('should allow the request', async () => {
      const result = await rateLimiter.consume(BUCKET, KEY, options)

      expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 })
    })
  })

  describe('and the limit has already been reached', () => {
    beforeEach(async () => {
      for (let i = 0; i < options.max; i++) {
        await rateLimiter.consume(BUCKET, KEY, options)
      }
    })

    it('should block the next request', async () => {
      const result = await rateLimiter.consume(BUCKET, KEY, options)

      expect(result.allowed).toBe(false)
    })

    it('should report a positive retryAfterSeconds', async () => {
      const result = await rateLimiter.consume(BUCKET, KEY, options)

      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    })
  })

  describe('and a new window has begun after the limit was reached', () => {
    beforeEach(async () => {
      for (let i = 0; i < options.max; i++) {
        await rateLimiter.consume(BUCKET, KEY, options)
      }
      // Advance past the window so `windowStart` (and thus the cache key) changes.
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS + options.windowSeconds * 1000)
    })

    it('should allow requests again', async () => {
      const result = await rateLimiter.consume(BUCKET, KEY, options)

      expect(result.allowed).toBe(true)
    })
  })
})
