import { randomInt } from 'crypto'
import { v4 as uuid } from 'uuid'
import { METHOD_DCL_PERSONAL_SIGN } from '../../../ports/server/constants'
import { InvalidResponseMessage, RequestMessage, RequestResponseMessage } from '../../../ports/server/types'
import { validateRequestMessage } from '../../../ports/server/validations'
import { validateAuthChain } from '../../auth-chain'
import { isErrorWithMessage } from '../../error-handling'
import { SocketHandlerContext, SocketMessageHandler } from '../types'

export type SocketRequestExpirationOptions = {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
}

// REQUEST — registers a new auth request from a connected client and returns its id/code/expiration.
export function createRequestSocketHandler(options: SocketRequestExpirationOptions): SocketMessageHandler {
  return async (context: SocketHandlerContext, data: unknown) => {
    const {
      components: { storage },
      logger,
      socket
    } = context

    logger.log('Received a request')

    let msg: RequestMessage
    try {
      msg = validateRequestMessage(data)
    } catch (e) {
      logger.log('Received a request with invalid message')
      return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
    }

    let sender: string | undefined

    if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
      // Same validation as the HTTP /requests handler (shared to avoid drift).
      try {
        sender = (await validateAuthChain(msg.authChain || [])).sender
      } catch (e) {
        logger.log('Received a request with an invalid auth chain')
        return { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage
      }
    }

    const requestId = uuid()
    const expiration = new Date(
      Date.now() +
        (msg.method !== METHOD_DCL_PERSONAL_SIGN ? options.requestExpirationInSeconds : options.dclPersonalSignExpirationInSeconds) * 1000
    )
    // Cryptographically secure so the pairing code the user visually confirms can't be predicted.
    const code = randomInt(0, 100)

    await storage.setRequest(requestId, {
      requestId,
      socketId: socket.id,
      requiresValidation: false,
      expiration,
      code,
      method: msg.method,
      params: msg.params,
      sender: sender?.toLowerCase()
    })

    logger.log(`[METHOD:${msg.method}][RID:${requestId}][EXP:${expiration.getTime()}] Successfully registered request response`)

    return { requestId, expiration, code } satisfies RequestResponseMessage
  }
}
