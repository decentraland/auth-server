/**
 * Base class for the request-lifecycle guard failures shared by the HTTP and socket
 * handlers. Carries the offending `requestId` so callers can log with an `[RID:…]` prefix,
 * and lets handlers detect an expected guard failure (`instanceof RequestStateError`) from
 * an unexpected throw that should propagate to the error middleware / Sentry.
 */
export abstract class RequestStateError extends Error {
  constructor(message: string, public readonly requestId: string) {
    super(message)
    this.name = new.target.name
  }
}

/** No request exists for the id. Maps to HTTP 404. */
export class RequestNotFoundError extends RequestStateError {
  constructor(requestId: string) {
    super(`Request with id "${requestId}" not found`, requestId)
  }
}

/** The request was already consumed (its outcome was delivered). Maps to HTTP 410. */
export class RequestAlreadyFulfilledError extends RequestStateError {
  constructor(requestId: string) {
    super(`Request with id "${requestId}" has already been fulfilled`, requestId)
  }
}

/** An outcome was already stored for this request. Maps to HTTP 400. */
export class RequestAlreadyHasResponseError extends RequestStateError {
  constructor(requestId: string) {
    super(`Request with id "${requestId}" already has a response`, requestId)
  }
}

/** The request's expiration has passed. Maps to HTTP 410. */
export class RequestExpiredError extends RequestStateError {
  constructor(requestId: string) {
    super(`Request with id "${requestId}" has expired`, requestId)
  }
}
