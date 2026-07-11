/**
 * Tenderly rejected our access key (HTTP 401/403). This is a server
 * misconfiguration (bad/expired key or wrong account/project), not a client
 * error, so the handler maps it to HTTP 500.
 */
export class TenderlyAuthError extends Error {
  constructor(message = 'Tenderly rejected the access key') {
    super(message)
    this.name = 'TenderlyAuthError'
  }
}

/**
 * Tenderly considered the simulation request invalid (HTTP 400/422, or a 200
 * response carrying a top-level `error` object). Maps to HTTP 400.
 */
export class TenderlyBadRequestError extends Error {
  constructor(message = 'Tenderly rejected the simulation request') {
    super(message)
    this.name = 'TenderlyBadRequestError'
  }
}

/** Tenderly returned HTTP 429 for the simulation request. Maps to HTTP 429. */
export class TenderlyRateLimitError extends Error {
  constructor(message = 'Tenderly simulation rate limit exceeded') {
    super(message)
    this.name = 'TenderlyRateLimitError'
  }
}

/**
 * Tenderly was unreachable or failed (5xx, network error, or timeout). Maps to
 * HTTP 502.
 */
export class TenderlyUnavailableError extends Error {
  constructor(message = 'Tenderly is unavailable') {
    super(message)
    this.name = 'TenderlyUnavailableError'
  }
}
