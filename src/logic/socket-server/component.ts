import { Server as HttpServer } from 'http'
import * as Sentry from '@sentry/node'
import { IBaseComponent } from '@well-known-components/interfaces'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { getUnderlyingServer } from '@dcl/http-server'
import { METHOD_DCL_PERSONAL_SIGN } from '../../ports/server/constants'
import {
  InvalidResponseMessage,
  MessageType,
  OutcomeMessage,
  OutcomeResponseMessage,
  RecoverMessage,
  RecoverResponseMessage,
  RequestMessage,
  RequestResponseMessage,
  RequestValidationMessage
} from '../../ports/server/types'
import {
  validateOutcomeMessage,
  validateRecoverMessage,
  validateRequestMessage,
  validateRequestValidationMessage
} from '../../ports/server/validations'
import { AppComponents } from '../../types'
import { isErrorWithMessage } from '../error-handling'
import { ISocketServerComponent } from './types'

export type SocketServerOptions = {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
  cors: {
    origin: RegExp[]
    methods: string
  }
}

export async function createSocketServerComponent(
  { logs, storage, tracer, server }: Pick<AppComponents, 'logs' | 'storage' | 'tracer' | 'server'>,
  { requestExpirationInSeconds, dclPersonalSignExpirationInSeconds, cors }: SocketServerOptions
): Promise<ISocketServerComponent> {
  const logger = logs.getLogger('websocket-server')

  const sockets: Record<string, Socket> = {}

  let io: Server | null = null

  const onConnection = (socket: Socket) =>
    tracer.span('websocket-connection', () => {
      // Do some work here
      logger.log('Connected')
      sockets[socket.id] = socket

      const parentTracingContext = tracer.getTrace()

      socket.on('disconnect', () =>
        tracer.span(
          'websocket-disconnect',
          () => {
            logger.log('Disconnected')
            // Don't delete requests on disconnect — let them expire naturally via TTL.
            // This prevents the race condition where the user is still completing
            // the auth flow when the game client's socket temporarily disconnects.
            delete sockets[socket.id]
          },
          parentTracingContext
        )
      )

      // Wraps the callback function on messages to type the message that is being sent.
      // On the client, the response will be received using socket.emitWithAck().
      const ack = <T>(cb: (...args: unknown[]) => void, msg: T) =>
        tracer.span(
          'websocket-ack',
          () => {
            try {
              cb(msg)
            } catch (e) {
              // This might happen if the request was done with socket.emit instead of socket.emitWithAck.
              logger.error(`There was an error sending the response message: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
            }
          },
          parentTracingContext
        )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.REQUEST, async (data: any, cb) =>
        tracer
          .span(
            'websocket-request',
            async () => {
              let msg: RequestMessage
              logger.log('Received a request')

              try {
                msg = validateRequestMessage(data)
              } catch (e) {
                ack<InvalidResponseMessage>(cb, {
                  error: isErrorWithMessage(e) ? e.message : 'Unknown error'
                })
                logger.log('Received a request with invalid message')

                return
              }

              let sender: string | undefined

              if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
                const authChain = msg.authChain

                if (!authChain) {
                  ack<InvalidResponseMessage>(cb, {
                    error: 'Auth chain is required'
                  })
                  logger.log('Received a request without an auth chain')
                  return
                }

                sender = Authenticator.ownerAddress(authChain)

                let finalAuthority: string

                try {
                  finalAuthority = parseEmphemeralPayload(authChain[authChain.length - 1].payload).ephemeralAddress
                } catch (e) {
                  ack<InvalidResponseMessage>(cb, {
                    error: 'Could not get final authority from auth chain'
                  })
                  logger.log('Received a request with invalid auth chain')
                  return
                }

                const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

                if (!validationResult.ok) {
                  ack<InvalidResponseMessage>(cb, {
                    error: validationResult.message ?? 'Signature validation failed'
                  })

                  logger.log('Received a request with invalid signature')
                  return
                }
              }

              const requestId = uuid()
              const expiration = new Date(
                Date.now() +
                  (msg.method !== METHOD_DCL_PERSONAL_SIGN ? requestExpirationInSeconds : dclPersonalSignExpirationInSeconds) * 1000
              )
              const code = Math.floor(Math.random() * 100)

              await storage.setRequest(requestId, {
                requestId: requestId,
                socketId: socket.id,
                requiresValidation: false,
                expiration,
                code,
                method: msg.method,
                params: msg.params,
                sender: sender?.toLowerCase()
              })

              ack<RequestResponseMessage>(cb, {
                requestId,
                expiration,
                code
              })

              logger.log(`[METHOD:${msg.method}][RID:${requestId}][EXP:${expiration.getTime()}] Successfully registered request response`)
            },
            parentTracingContext
          )
          .catch(e => {
            Sentry.captureException(e)
            logger.error(`Unexpected error in ${MessageType.REQUEST} handler: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
            ack<InvalidResponseMessage>(cb, { error: 'Internal server error' })
          })
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.RECOVER, (data: any, cb) =>
        tracer
          .span(
            'websocket-recover',
            async () => {
              let msg: RecoverMessage
              logger.log('Received a recover request')

              try {
                msg = validateRecoverMessage(data)
              } catch (e) {
                ack<InvalidResponseMessage>(cb, {
                  error: isErrorWithMessage(e) ? e.message : 'Unknown error'
                })

                logger.log('Received a recover request with invalid message')
                return
              }

              const request = await storage.getRequest(msg.requestId)

              if (!request) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" not found`
                })

                logger.log(`[RID:${msg.requestId}] Received a recover request for a non-existent request`)

                return
              }

              if (request.fulfilled) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has already been fulfilled`
                })

                logger.log(`[RID:${msg.requestId}] Received a recover request for an already fulfilled request`)

                return
              }

              if (request.expiration < new Date()) {
                await storage.setRequest(msg.requestId, null)

                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has expired`
                })

                logger.log(`[RID:${msg.requestId}] Received a recover request for an expired request`)

                return
              }

              ack<RecoverResponseMessage>(cb, {
                expiration: request.expiration,
                code: request.code,
                method: request.method,
                params: request.params,
                sender: request.sender
              })

              logger.log(
                `[METHOD:${request.method}][RID:${request.requestId}][EXP:${request.expiration.getTime()}] Successfully recovered request`
              )
            },
            parentTracingContext
          )
          .catch(e => {
            Sentry.captureException(e)
            logger.error(`Unexpected error in ${MessageType.RECOVER} handler: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
            ack<InvalidResponseMessage>(cb, { error: 'Internal server error' })
          })
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.OUTCOME, (data: any, cb) =>
        tracer
          .span(
            'websocket-outcome',
            async () => {
              let msg: OutcomeMessage

              try {
                msg = validateOutcomeMessage(data)
              } catch (e) {
                ack<InvalidResponseMessage>(cb, {
                  error: isErrorWithMessage(e) ? e.message : 'Unknown error'
                })

                logger.log('Received an outcome message with invalid message')

                return
              }

              const request = await storage.getRequest(msg.requestId)

              if (!request) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" not found`
                })

                logger.log(`[RID:${msg.requestId}] Received an outcome message for a non-existent request`)

                return
              }

              if (request.fulfilled) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has already been fulfilled`
                })

                logger.log(`[RID:${msg.requestId}] Received an outcome message for an already fulfilled request`)

                return
              }

              if (request.response) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" already has a response`
                })

                logger.log(`[RID:${msg.requestId}] Received an outcome message for a request that already has a response`)

                return
              }

              if (request.expiration < new Date()) {
                await storage.setRequest(msg.requestId, null)

                ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has expired`
                })

                logger.log(`[RID:${msg.requestId}] Received an outcome message for an expired request`)

                return
              }

              const outcomeMessage: OutcomeResponseMessage = msg

              // If it has a socketId and the socket is still connected, send via socket.
              // Otherwise, store the response for polling via GET /requests/:requestId.
              if (request.socketId && sockets[request.socketId]) {
                const storedSocket = sockets[request.socketId]

                // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
                await storage.setRequest(msg.requestId, {
                  requestId: msg.requestId,
                  socketId: request.socketId,
                  fulfilled: true,
                  expiration: request.expiration,
                  code: 0,
                  method: '',
                  params: [],
                  requiresValidation: false
                })

                storedSocket.emit(MessageType.OUTCOME, outcomeMessage)
                logger.log(
                  `[METHOD:${request.method}][RID:${
                    request.requestId
                  }][EXP:${request.expiration.getTime()}] Successfully sent outcome message to the client`
                )
              } else {
                // Socket gone or HTTP-created request — persist response for polling
                await storage.setRequest(msg.requestId, {
                  ...request,
                  response: outcomeMessage
                })
                logger.log(
                  `[METHOD:${request.method}][RID:${
                    request.requestId
                  }][EXP:${request.expiration.getTime()}] Stored outcome for polling (socket unavailable)`
                )
              }

              ack<object>(cb, {})
            },
            parentTracingContext
          )
          .catch(e => {
            Sentry.captureException(e)
            logger.error(`Unexpected error in ${MessageType.OUTCOME} handler: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
            ack<InvalidResponseMessage>(cb, { error: 'Internal server error' })
          })
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.REQUEST_VALIDATION_STATUS, (data: any, cb) => {
        tracer
          .span(
            'websocket-request-validation',
            async () => {
              let msg: RequestValidationMessage

              try {
                msg = validateRequestValidationMessage(data)
              } catch (e) {
                logger.log('Received an outcome message with invalid message')
                return ack<InvalidResponseMessage>(cb, {
                  error: isErrorWithMessage(e) ? e.message : 'Unknown error'
                })
              }

              const request = await storage.getRequest(msg.requestId)

              if (!request) {
                logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it doesn't exist`)
                return ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" not found`
                })
              }

              if (request.fulfilled) {
                logger.log(
                  `[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has already been fulfilled`
                )
                return ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has already been fulfilled`
                })
              }

              if (request.expiration < new Date()) {
                await storage.setRequest(msg.requestId, null)

                logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has expired`)
                return ack<InvalidResponseMessage>(cb, {
                  error: `Request with id "${msg.requestId}" has expired`
                })
              }

              if (request.socketId && sockets[request.socketId] && !request.requiresValidation) {
                const storedSocket = sockets[request.socketId]

                // Relay the request validation to the client
                storedSocket.emit(MessageType.REQUEST_VALIDATION_STATUS, { requestId: msg.requestId, code: request.code })
              }

              request.requiresValidation = true

              ack<object>(cb, {})
            },
            parentTracingContext
          )
          .catch(e => {
            Sentry.captureException(e)
            logger.error(
              `Unexpected error in ${MessageType.REQUEST_VALIDATION_STATUS} handler: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`
            )
            ack<InvalidResponseMessage>(cb, { error: 'Internal server error' })
          })
      })
    })

  const start: IBaseComponent['start'] = async () => {
    if (io) {
      return
    }

    logger.log('Starting socket server...')

    // The @dcl/http-server is already listening at this point (startComponents ran the
    // http-server's lifecycle first). Attach socket.io to its underlying Node http.Server so
    // socket.io owns the `/socket.io/*` namespace and the HTTP `upgrade` event, while the
    // http-server keeps handling every other request.
    const httpServer = await getUnderlyingServer<HttpServer>(server)

    io = new Server(httpServer, { cors })
    io.on('connection', onConnection)

    logger.log('Socket server attached to the HTTP server')
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!io) {
      return
    }

    logger.log('Stopping socket server...')

    const currentIo = io

    currentIo.off('connection', onConnection)

    // Detach socket.io WITHOUT closing the underlying HTTP server: the http-server component owns
    // that server's lifecycle. socket.io's own `close()` would call `httpServer.close()`, a double
    // close on top of the http-server's terminator (→ `ERR_SERVER_NOT_RUNNING`). Instead, disconnect
    // every client and close the engine; the http-server component then shuts the server down cleanly.
    currentIo.disconnectSockets(true)
    currentIo.engine.close()

    io = null

    for (const socketId of Object.keys(sockets)) {
      delete sockets[socketId]
    }
  }

  const emitToSocket: ISocketServerComponent['emitToSocket'] = (socketId, type, message) => {
    const storedSocket = sockets[socketId]
    if (!storedSocket) {
      return false
    }
    storedSocket.emit(type, message)
    return true
  }

  const isSocketConnected: ISocketServerComponent['isSocketConnected'] = socketId => !!sockets[socketId]

  return {
    start,
    stop,
    emitToSocket,
    isSocketConnected
  }
}
