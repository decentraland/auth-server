import { AppComponents } from '../../types'
import { IRateLimiterComponent, RateLimitOptions, RateLimitResult } from './types'

/**
 * Creates a fixed-window rate limiter backed by the shared cache port
 * (Redis-backed in production, in-memory otherwise). Each window is identified
 * by `Math.floor(now / windowSeconds)`, so a counter naturally resets when the
 * window rolls over and the cache entry is given a matching TTL.
 *
 * @param components - `cache`.
 * @returns The rate limiter component.
 */
export function createRateLimiterComponent({ cache }: Pick<AppComponents, 'cache'>): IRateLimiterComponent {
  const consume = async (bucket: string, key: string, { max, windowSeconds }: RateLimitOptions): Promise<RateLimitResult> => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowStart = Math.floor(nowSeconds / windowSeconds)
    const cacheKey = `ratelimit:${bucket}:${key}:${windowStart}`

    // NOTE: this get-then-set is deliberately NOT atomic. Under high concurrency a
    // small number of requests may slip past the limit, which is acceptable for
    // abuse control (we are not enforcing a hard quota, just throttling floods).
    const current = (await cache.get<number>(cacheKey)) ?? 0

    if (current >= max) {
      const windowEndSeconds = (windowStart + 1) * windowSeconds
      return { allowed: false, retryAfterSeconds: Math.max(1, windowEndSeconds - nowSeconds) }
    }

    await cache.set(cacheKey, current + 1, windowSeconds)
    return { allowed: true, retryAfterSeconds: 0 }
  }

  return { consume }
}
