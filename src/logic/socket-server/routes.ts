import { MessageType } from '../../ports/server/types'
import { outcomeSocketHandler } from './handlers/outcome'
import { recoverSocketHandler } from './handlers/recover'
import { createRequestSocketHandler, SocketRequestExpirationOptions } from './handlers/request'
import { requestValidationSocketHandler } from './handlers/request-validation'
import { SocketRoute } from './types'

/**
 * Binds each socket message type to its handler and tracing span — the socket analog of the HTTP
 * `setupRouter`. The connection wrapper in the component consumes these to register `socket.on`
 * listeners with shared span / ack / error handling.
 */
export function getSocketRoutes(options: SocketRequestExpirationOptions): SocketRoute[] {
  return [
    { event: MessageType.REQUEST, span: 'websocket-request', handle: createRequestSocketHandler(options) },
    { event: MessageType.RECOVER, span: 'websocket-recover', handle: recoverSocketHandler },
    { event: MessageType.OUTCOME, span: 'websocket-outcome', handle: outcomeSocketHandler },
    { event: MessageType.REQUEST_VALIDATION_STATUS, span: 'websocket-request-validation', handle: requestValidationSocketHandler }
  ]
}
