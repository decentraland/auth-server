/** Fixed-window rate-limit configuration for a single `consume` call. */
export type RateLimitOptions = {
  /** Maximum number of requests permitted within a window. */
  max: number
  /** Window length in seconds. */
  windowSeconds: number
}

/** Outcome of a `consume` call. */
export type RateLimitResult = {
  /** `true` if the request is within the limit and was counted. */
  allowed: boolean
  /** Seconds until the current window resets (only meaningful when `allowed` is `false`). */
  retryAfterSeconds: number
}

export type IRateLimiterComponent = {
  /**
   * Counts one request against a fixed window and reports whether it is allowed.
   * @param bucket - Logical limiter name (e.g. `'simulations'`).
   * @param key - Per-caller key within the bucket (e.g. the client IP).
   * @param options - `max` requests per `windowSeconds`.
   */
  consume(bucket: string, key: string, options: RateLimitOptions): Promise<RateLimitResult>
}
