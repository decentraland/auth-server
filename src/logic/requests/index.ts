import { ILoggerComponent } from '@well-known-components/interfaces'
import { InvalidResponseMessage } from '../../ports/server/types'
import { IStorageComponent, StorageRequest } from '../../ports/storage/types'
import {
  RequestAlreadyFulfilledError,
  RequestAlreadyHasResponseError,
  RequestExpiredError,
  RequestNotFoundError,
  RequestStateError
} from './errors'

export * from './errors'

export type LoadActiveRequestOptions = {
  /**
   * Reject the request when it already carries a stored response. Used by the outcome-submission
   * paths (they must not overwrite an existing outcome); the polling read path leaves it off
   * because it *requires* a response to be present.
   */
  rejectIfHasResponse?: boolean
}

/**
 * Loads a request by id and asserts it is still actionable, applying the guards every
 * request-lifecycle handler shares (HTTP and socket): not-found, already-fulfilled,
 * optionally already-has-response, then expired. Guard order is significant and matches
 * the previous per-handler code. On expiry the request is purged from storage (the side
 * effect that was duplicated across every handler) before the error is thrown.
 *
 * Throws the typed errors in `./errors`; callers map them to an HTTP status
 * (`requestStateErrorToHttpResponse`) or a socket error payload.
 */
export async function loadActiveRequest(
  storage: Pick<IStorageComponent, 'getRequest' | 'setRequest'>,
  requestId: string,
  options: LoadActiveRequestOptions = {}
): Promise<StorageRequest> {
  const request = await storage.getRequest(requestId)

  if (!request) {
    throw new RequestNotFoundError(requestId)
  }

  if (request.fulfilled) {
    throw new RequestAlreadyFulfilledError(requestId)
  }

  if (options.rejectIfHasResponse && request.response) {
    throw new RequestAlreadyHasResponseError(requestId)
  }

  if (request.expiration < new Date()) {
    await storage.setRequest(requestId, null)
    throw new RequestExpiredError(requestId)
  }

  return request
}

/** Maps a request-lifecycle guard failure to its HTTP status and response body. */
export function requestStateErrorToHttpResponse(error: RequestStateError): {
  status: number
  body: InvalidResponseMessage
} {
  const body = { error: error.message } satisfies InvalidResponseMessage

  if (error instanceof RequestNotFoundError) {
    return { status: 404, body }
  }

  if (error instanceof RequestAlreadyHasResponseError) {
    return { status: 400, body }
  }

  // RequestAlreadyFulfilledError and RequestExpiredError both signal a request that existed but is
  // no longer actionable.
  return { status: 410, body }
}

/**
 * Logs a guard failure for an inbound message about an existing request, preserving the
 * `[RID:…] Received <subject> for a <state> request` wording the handlers used. `subject`
 * is the per-handler noun phrase, e.g. `'an outcome message'` or `'a recover request'`.
 */
export function logInboundRequestStateError(
  logger: ILoggerComponent.ILogger,
  requestId: string,
  subject: string,
  error: RequestStateError
): void {
  if (error instanceof RequestNotFoundError) {
    logger.log(`[RID:${requestId}] Received ${subject} for a non-existent request`)
  } else if (error instanceof RequestAlreadyFulfilledError) {
    logger.log(`[RID:${requestId}] Received ${subject} for an already fulfilled request`)
  } else if (error instanceof RequestAlreadyHasResponseError) {
    logger.log(`[RID:${requestId}] Received ${subject} for a request that already has a response`)
  } else if (error instanceof RequestExpiredError) {
    logger.log(`[RID:${requestId}] Received ${subject} for an expired request`)
  }
}
