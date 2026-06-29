/**
 * The Magic DID token could not be validated (malformed, bad signature, signer
 * mismatch, or audience mismatch). Maps to HTTP 401.
 */
export class MagicTokenInvalidError extends Error {
  constructor(message = 'Invalid Magic DID token') {
    super(message)
    this.name = 'MagicTokenInvalidError'
  }
}

/**
 * The Magic DID token is expired or not yet usable (`ext` / `nbf`).
 * Maps to HTTP 401.
 */
export class MagicTokenExpiredError extends Error {
  constructor(message = 'Magic DID token has expired') {
    super(message)
    this.name = 'MagicTokenExpiredError'
  }
}

/**
 * Magic rejected our secret key when calling the deletion endpoint (HTTP 401
 * from Magic). This is a server misconfiguration, not a client error.
 */
export class MagicAuthError extends Error {
  constructor(message = 'Magic rejected the secret key') {
    super(message)
    this.name = 'MagicAuthError'
  }
}

/** Magic returned HTTP 429 for the deletion request. Maps to HTTP 429. */
export class MagicRateLimitError extends Error {
  constructor(message = 'Magic deletion rate limit exceeded') {
    super(message)
    this.name = 'MagicRateLimitError'
  }
}

/** Magic returned an unexpected error for the deletion request. Maps to HTTP 500. */
export class MagicDeletionError extends Error {
  constructor(message = 'Magic deletion request failed') {
    super(message)
    this.name = 'MagicDeletionError'
  }
}
