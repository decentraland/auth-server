import { randomInt } from 'crypto'
import { v4 as uuid } from 'uuid'
import { validateAuthChain } from '../../logic/auth-chain'
import { isErrorWithMessage } from '../../logic/error-handling'
import { loadActiveRequest, logInboundRequestStateError, RequestStateError, requestStateErrorToHttpResponse } from '../../logic/requests'
import { METHOD_DCL_PERSONAL_SIGN } from '../../ports/server/constants'
import {
  HttpOutcomeMessage,
  InvalidResponseMessage,
  MessageType,
  OutcomeResponseMessage,
  RecoverResponseMessage,
  RequestMessage,
  RequestResponseMessage,
  RequestValidationStatusMessage
} from '../../ports/server/types'
import { validateHttpOutcomeMessage, validateRequestMessage } from '../../ports/server/validations'
import { StorageRequest } from '../../ports/storage/types'
import { HandlerContextWithPath } from '../../types'
import { parseJsonBody } from '../utils'

export type RequestsHandlerComponents = 'storage' | 'logs' | 'socketServer'

export type RequestExpirationOptions = {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
}

// POST /requests — register a new request
export function createRequestHandler({ requestExpirationInSeconds, dclPersonalSignExpirationInSeconds }: RequestExpirationOptions) {
  return async function requestHandler(context: HandlerContextWithPath<RequestsHandlerComponents, '/requests'>) {
    const {
      components: { storage }
    } = context

    const data = await parseJsonBody(context.request)
    let msg: RequestMessage

    try {
      msg = validateRequestMessage(data)
    } catch (e) {
      return {
        status: 400,
        body: { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
      }
    }

    let sender: string | undefined

    if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
      try {
        const { sender: validatedSender } = await validateAuthChain(msg.authChain || [])
        sender = validatedSender
      } catch (e) {
        return {
          status: 400,
          body: { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
        }
      }
    }

    const requestId = uuid()
    const expiration = new Date(
      Date.now() + (msg.method !== METHOD_DCL_PERSONAL_SIGN ? requestExpirationInSeconds : dclPersonalSignExpirationInSeconds) * 1000
    )
    // Cryptographically secure so the pairing code the user visually confirms can't be predicted.
    const code = randomInt(0, 100)

    await storage.setRequest(requestId, {
      requestId: requestId,
      expiration,
      code,
      method: msg.method,
      params: msg.params,
      sender: sender?.toLowerCase(),
      requiresValidation: false
    })

    return {
      status: 201,
      body: { requestId, expiration, code } satisfies RequestResponseMessage
    }
  }
}

// GET /v2/requests/:requestId — get a request by id
export async function getRequestHandler(context: HandlerContextWithPath<RequestsHandlerComponents, '/v2/requests/:requestId'>) {
  const {
    params: { requestId },
    components: { storage }
  } = context

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      return requestStateErrorToHttpResponse(e)
    }
    throw e
  }

  return {
    status: 200,
    body: {
      expiration: request.expiration,
      code: request.code,
      method: request.method,
      params: request.params,
      sender: request.sender
    } satisfies RecoverResponseMessage
  }
}

// POST /v2/requests/:requestId/validation — communicate that the request must be validated
export async function notifyRequestValidationHandler(
  context: HandlerContextWithPath<RequestsHandlerComponents, '/v2/requests/:requestId/validation'>
) {
  const {
    params: { requestId },
    components: { storage, logs, socketServer }
  } = context

  const logger = logs.getLogger('websocket-server')

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      logInboundRequestStateError(logger, requestId, 'a validation request message', e)
      return requestStateErrorToHttpResponse(e)
    }
    throw e
  }

  if (request.socketId && socketServer.isSocketConnected(request.socketId) && !request.requiresValidation) {
    logger.log(`[RID:${requestId}] Successfully sent request validation to the client via socket`)
    // Send the request validation to the client
    socketServer.emitToSocket(request.socketId, MessageType.REQUEST_VALIDATION_STATUS, { requestId })
  }

  // Persist the flag: storage.getRequest returns a copy, so mutating `request` alone would be lost
  // (and GET /v2/requests/:id/validation would always report false).
  request.requiresValidation = true
  await storage.setRequest(requestId, request)

  return { status: 204, body: undefined }
}

// GET /v2/requests/:requestId/validation — get the request validation status
export async function getRequestValidationStatusHandler(
  context: HandlerContextWithPath<RequestsHandlerComponents, '/v2/requests/:requestId/validation'>
) {
  const {
    params: { requestId },
    components: { storage }
  } = context

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      return requestStateErrorToHttpResponse(e)
    }
    throw e
  }

  return {
    status: 200,
    body: { requiresValidation: request.requiresValidation } satisfies RequestValidationStatusMessage
  }
}

// GET /requests/:requestId — get the outcome of a request
export async function getOutcomeHandler(context: HandlerContextWithPath<RequestsHandlerComponents, '/requests/:requestId'>) {
  const {
    params: { requestId },
    components: { storage, logs }
  } = context

  const logger = logs.getLogger('websocket-server')

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, requestId)
  } catch (e) {
    if (e instanceof RequestStateError) {
      return requestStateErrorToHttpResponse(e)
    }
    throw e
  }

  if (!request.response) {
    // Not completed yet — 204 No Content (no body, per the HTTP spec) so the client keeps polling.
    return { status: 204, body: undefined }
  }

  logger.log(`[RID:${requestId}] Successfully sent outcome message to the client via HTTP`)

  // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
  await storage.setRequest(requestId, {
    requestId,
    fulfilled: true,
    expiration: request.expiration,
    code: 0,
    method: '',
    params: [],
    requiresValidation: false
  })

  return { status: 200, body: request.response satisfies OutcomeResponseMessage }
}

// POST /v2/requests/:requestId/outcome — record the outcome of a request
export async function createOutcomeHandler(context: HandlerContextWithPath<RequestsHandlerComponents, '/v2/requests/:requestId/outcome'>) {
  const {
    params: { requestId },
    components: { storage, logs, socketServer }
  } = context

  const logger = logs.getLogger('websocket-server')

  const data = await parseJsonBody(context.request)
  let msg: HttpOutcomeMessage

  try {
    msg = validateHttpOutcomeMessage(data)
  } catch (e) {
    return {
      status: 400,
      body: { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
    }
  }

  let request: StorageRequest
  try {
    request = await loadActiveRequest(storage, requestId, { rejectIfHasResponse: true })
  } catch (e) {
    if (e instanceof RequestStateError) {
      logInboundRequestStateError(logger, requestId, 'an outcome message', e)
      return requestStateErrorToHttpResponse(e)
    }
    throw e
  }

  const outcomeMessage: OutcomeResponseMessage = {
    ...msg,
    requestId
  }

  if (request.socketId && socketServer.isSocketConnected(request.socketId)) {
    socketServer.emitToSocket(request.socketId, MessageType.OUTCOME, outcomeMessage)
    logger.log(
      `[METHOD:${request.method}][RID:${
        request.requestId
      }][EXP:${request.expiration.getTime()}] Successfully sent outcome message to the client via socket`
    )
    // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
    await storage.setRequest(requestId, {
      requestId,
      socketId: request.socketId,
      fulfilled: true,
      expiration: request.expiration,
      code: 0,
      method: '',
      params: [],
      requiresValidation: false
    })
  } else {
    // Socket gone or HTTP-created request — persist response for polling via GET /requests/:requestId
    await storage.setRequest(requestId, {
      ...request,
      response: outcomeMessage
    })
    logger.log(
      `[METHOD:${request.method}][RID:${
        request.requestId
      }][EXP:${request.expiration.getTime()}] Stored outcome for polling (socket unavailable)`
    )
  }

  return { status: 200, body: undefined }
}
