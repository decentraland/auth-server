import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import bodyParser from 'body-parser'
import cors from 'cors'
import { ethers } from 'ethers'
import express, { Request, Response } from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import { express as authMiddleware, DecentralandSignatureData } from 'decentraland-crypto-middleware'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { METHOD_DCL_PERSONAL_SIGN, FIFTEEN_MINUTES_IN_MILLISECONDS } from './constants'
import { extractClientIp, validateIpAddress } from './ip-utils'
import {
  HttpOutcomeMessage,
  IServerComponent,
  IdentityResponse,
  IdentityIdValidationResponse,
  InvalidResponseMessage,
  LiveResponseMessage,
  MessageType,
  OutcomeMessage,
  OutcomeResponseMessage,
  RecoverMessage,
  RecoverResponseMessage,
  RequestMessage,
  RequestResponseMessage,
  RequestValidationMessage,
  RequestValidationStatusMessage
} from './types'
import {
  validateHttpOutcomeMessage,
  validateOutcomeMessage,
  validateRecoverMessage,
  validateRequestMessage,
  validateRequestValidationMessage,
  validateIdentityId,
  validateIdentityRequest
} from './validations'

export async function createServerComponent({
  config,
  logs,
  storage,
  tracer,
  metrics,
  requestExpirationInSeconds,
  dclPersonalSignExpirationInSeconds
}: Pick<AppComponents, 'config' | 'logs' | 'storage' | 'tracer' | 'metrics'> & {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
}): Promise<IServerComponent> {
  // Wraps the callback function on messages to type the message that is being sent
  const sendResponse = <T>(res: Response, statusCode: number, msg: T) => {
    res.status(statusCode).json(msg)
  }

  const port = await config.requireNumber('HTTP_SERVER_PORT')
  const logger = logs.getLogger('websocket-server')

  const corsOptions = {
    origin: (await config.requireString('CORS_ORIGIN')).split(';').map(origin => new RegExp(origin)),
    methods: await config.requireString('CORS_METHODS')
  }

  const sockets: Record<string, Socket> = {}

  let server: Server | null = null

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

            const requestId = storage.getRequestIdForSocketId(socket.id)

            if (requestId) {
              storage.setRequest(requestId, null)
            }

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
        tracer.span(
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

            // Extract IP information
            const originalIp = extractClientIp(socket)

            // Track metrics
            metrics.increment('ip_extraction_total', { method: 'websocket', result: originalIp === 'unknown' ? 'failed' : 'success' })

            storage.setRequest(requestId, {
              requestId: requestId,
              socketId: socket.id,
              requiresValidation: false,
              expiration,
              code,
              method: msg.method,
              params: msg.params,
              sender: sender?.toLowerCase(),
              originalIp
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
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.RECOVER, (data: any, cb) =>
        tracer.span(
          'websocket-recover',
          () => {
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

            const request = storage.getRequest(msg.requestId)

            if (!request) {
              ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" not found`
              })

              logger.log(`[RID:${msg.requestId}] Received a recover request for a non-existent request`)

              return
            }

            if (request.expiration < new Date()) {
              storage.setRequest(msg.requestId, null)

              ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" has expired`
              })

              logger.log(`[RID:${msg.requestId}] Received a recover request for an expired request`)

              return
            }

            // IP validation for WebSocket
            const currentIp = extractClientIp(socket)
            const ipValidation = validateIpAddress(request.originalIp, currentIp)

            // Track validation metrics
            metrics.increment('ip_validation_total', {
              result: ipValidation.valid ? 'success' : 'failed',
              reason: ipValidation.reason || 'valid'
            })

            if (!ipValidation.valid) {
              ack<InvalidResponseMessage>(cb, {
                error: ipValidation.reason || 'IP validation failed'
              })

              logger.log(`[RID:${msg.requestId}] IP validation failed: ${ipValidation.reason}`)

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
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.OUTCOME, (data: any, cb) =>
        tracer.span(
          'websocket-outcome',
          () => {
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

            const request = storage.getRequest(msg.requestId)

            // If the response was already received, it's like the request doesn't exist anymore
            if (!request) {
              ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" not found`
              })

              logger.log(`[RID:${msg.requestId}] Received an outcome message for a non-existent request`)

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
              storage.setRequest(msg.requestId, null)

              ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" has expired`
              })

              logger.log(`[RID:${msg.requestId}] Received an outcome message for an expired request`)

              return
            }

            // If it has a socketId, it means it was a request by socket.io
            //  otherwise, we hold the response until the client polls for it.
            if (request.socketId) {
              const storedSocket = sockets[request.socketId]
              if (!storedSocket) {
                ack<InvalidResponseMessage>(cb, {
                  error: `Socket with id "${request.socketId}" not found`
                })

                logger.log(`[SID:${request.socketId}] Received an outcome message for a non-existent socket`)

                return
              }

              storage.setRequest(msg.requestId, null)

              const outcomeMessage: OutcomeResponseMessage = msg
              storedSocket.emit(MessageType.OUTCOME, outcomeMessage)
              logger.log(
                `[METHOD:${request.method}][RID:${
                  request.requestId
                }][EXP:${request.expiration.getTime()}] Successfully sent outcome message to the client`
              )
            } else {
              request.response = msg
            }

            ack<object>(cb, {})
          },
          parentTracingContext
        )
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.REQUEST_VALIDATION_STATUS, (data: any, cb) => {
        tracer.span(
          'websocket-request-validation',
          () => {
            let msg: RequestValidationMessage

            try {
              msg = validateRequestValidationMessage(data)
            } catch (e) {
              logger.log('Received an outcome message with invalid message')
              return ack<InvalidResponseMessage>(cb, {
                error: isErrorWithMessage(e) ? e.message : 'Unknown error'
              })
            }

            const request = storage.getRequest(msg.requestId)

            // If the response was already received, it's like the request doesn't exist anymore
            if (!request) {
              logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it doesn't exist`)
              return ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" not found`
              })
            }

            if (request.expiration < new Date()) {
              storage.setRequest(msg.requestId, null)

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
      })
    })

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }
    const logger = logs.getLogger('websocket-server')

    logger.log('Starting socket server...')

    const app = express()
    const httpServer = createServer(app)

    // Middleware to parse JSON in the request body
    app.use(bodyParser.json())
    app.use(cors(corsOptions))

    app.get('/health/ready', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/startup', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/live', (_req, res) => {
      return sendResponse<LiveResponseMessage>(res, 200, {
        timestamp: Date.now()
      })
    })

    // Helper function to validate auth chain
    const validateAuthChain = async (authChain: AuthChain): Promise<{ sender: string; finalAuthority: string }> => {
      if (!authChain.length) {
        throw new Error('Auth chain is required')
      }

      const sender = Authenticator.ownerAddress(authChain)

      let finalAuthority: string

      try {
        const ephemeralPayload = parseEmphemeralPayload(authChain[authChain.length - 1].payload)

        finalAuthority = ephemeralPayload.ephemeralAddress
      } catch (e) {
        if (e instanceof Error && e.message === 'Ephemeral payload has expired') {
          throw e
        }
        throw new Error('Could not get final authority from auth chain')
      }

      const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

      if (!validationResult.ok) {
        throw new Error(validationResult.message ?? 'Signature validation failed')
      }

      return { sender, finalAuthority }
    }

    app.post('/requests', async (req: Request, res: Response) => {
      const data = req.body
      let msg: RequestMessage

      try {
        msg = validateRequestMessage(data)
      } catch (e) {
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: isErrorWithMessage(e) ? e.message : 'Unknown error'
        })
      }

      let sender: string | undefined

      if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
        try {
          const { sender: validatedSender } = await validateAuthChain(msg.authChain || [])
          sender = validatedSender
        } catch (e) {
          return sendResponse<InvalidResponseMessage>(res, 400, {
            error: isErrorWithMessage(e) ? e.message : 'Unknown error'
          })
        }
      }

      const requestId = uuid()
      const expiration = new Date(
        Date.now() + (msg.method !== METHOD_DCL_PERSONAL_SIGN ? requestExpirationInSeconds : dclPersonalSignExpirationInSeconds) * 1000
      )
      const code = Math.floor(Math.random() * 100)

      // Extract IP information
      const originalIp = extractClientIp(req)

      // Track metrics
      metrics.increment('ip_extraction_total', { method: 'http', result: originalIp === 'unknown' ? 'failed' : 'success' })

      storage.setRequest(requestId, {
        requestId: requestId,
        expiration,
        code,
        method: msg.method,
        params: msg.params,
        sender: sender?.toLowerCase(),
        requiresValidation: false,
        originalIp
      })

      sendResponse<RequestResponseMessage>(res, 201, {
        requestId,
        expiration,
        code
      })
    })

    // Get a request by id
    app.get('/v2/requests/:requestId', async (req: Request, res: Response) => {
      const requestId = req.params.requestId
      const request = storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      // IP validation
      const currentIp = extractClientIp(req)
      const ipValidation = validateIpAddress(request.originalIp, currentIp)

      // Track validation metrics
      metrics.increment('ip_validation_total', {
        result: ipValidation.valid ? 'success' : 'failed',
        reason: ipValidation.reason || 'valid'
      })

      if (!ipValidation.valid) {
        return sendResponse<InvalidResponseMessage>(res, 403, {
          error: ipValidation.reason || 'IP validation failed'
        })
      }

      sendResponse<RecoverResponseMessage>(res, 200, {
        expiration: request.expiration,
        code: request.code,
        method: request.method,
        params: request.params,
        sender: request.sender
      })
    })

    // Communicate that the request must be validated
    app.post('/v2/requests/:requestId/validation', async (req: Request, res: Response) => {
      const requestId = req.params.requestId

      const request = storage.getRequest(requestId)

      if (!request) {
        logger.log(`[RID:${requestId}] Received a validation request message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.expiration < new Date()) {
        logger.log(`[RID:${requestId}] Received a validation request message for an expired request`)

        // Remove the request from the storage as it is expired
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      if (request.socketId && sockets[request.socketId] && !request.requiresValidation) {
        const storedSocket = sockets[request.socketId]

        logger.log(`[RID:${requestId}] Successfully sent request validation to the client via socket`)
        // Send the request validation to the client
        storedSocket.emit(MessageType.REQUEST_VALIDATION_STATUS, { requestId })
      }

      request.requiresValidation = true

      res.sendStatus(204)
    })

    // Get the request validation status
    app.get('/v2/requests/:requestId/validation', async (req: Request, res: Response) => {
      const requestId = req.params.requestId
      const request = storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      sendResponse<RequestValidationStatusMessage>(res, 200, { requiresValidation: request.requiresValidation })
    })

    // Get the outcome of a request
    app.get('/requests/:requestId', async (req: Request, res: Response) => {
      const requestId = req.params.requestId
      const request = storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      if (!request.response) {
        return sendResponse<InvalidResponseMessage>(res, 204, {
          error: `Request with id "${requestId}" has not been completed`
        })
      }

      logger.log(`[RID:${requestId}] Successfully sent outcome message to the client via HTTP`)

      storage.setRequest(requestId, null)
      sendResponse<OutcomeResponseMessage>(res, 200, request.response)
    })

    // Record the outcome of a request
    app.post('/v2/requests/:requestId/outcome', async (req: Request, res: Response) => {
      const requestId = req.params.requestId

      const data = req.body
      let msg: HttpOutcomeMessage

      try {
        msg = validateHttpOutcomeMessage(data)
      } catch (e) {
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: isErrorWithMessage(e) ? e.message : 'Unknown error'
        })
      }

      const request = storage.getRequest(requestId)

      // If the response was already received, it's like the request doesn't exist anymore
      if (!request) {
        logger.log(`[RID:${requestId}] Received an outcome message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.response) {
        logger.log(`[RID:${requestId}] Received an outcome message for a request that already has a response`)

        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: `Request with id "${requestId}" already has a response`
        })
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)

        logger.log(`[RID:${requestId}] Received an outcome message for an expired request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      const outcomeMessage: OutcomeResponseMessage = {
        ...msg,
        requestId
      }

      if (request.socketId && sockets[request.socketId]) {
        const storedSocket = sockets[request.socketId]
        storedSocket.emit(MessageType.OUTCOME, outcomeMessage)
        logger.log(
          `[METHOD:${request.method}][RID:${
            request.requestId
          }][EXP:${request.expiration.getTime()}] Successfully sent outcome message to the client via socket`
        )
        // Remove the request from the storage after it has been sent to the client
        storage.setRequest(requestId, null)
      } else {
        // Store the outcome message in the request
        request.response = {
          ...msg,
          requestId
        }
      }

      return res.sendStatus(200)
    })

    // Store identity endpoint with signed fetch middleware validation
    app.post(
      '/identities',
      authMiddleware({
        optional: false,
        onError: err => ({
          error: err.message,
          message: 'This endpoint requires a signed fetch request. See ADR-44.'
        }),
        verifyMetadataContent: metadata => metadata?.signer !== 'decentraland-kernel-scene' // prevent requests from scenes
      }),
      async (req: Request & DecentralandSignatureData) => {
        const res = req.res as Response
        try {
          const { identity } = validateIdentityRequest(req.body)

          if (!identity) {
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: 'AuthIdentity is required in request body'
            })
          }

          // Validate auth chain using the same logic as /requests endpoint
          try {
            const { sender: identitySender, finalAuthority } = await validateAuthChain(identity.authChain)

            // Verify that the ephemeral wallet address matches the finalAuthority from auth chain
            if (identity.ephemeralIdentity.address.toLowerCase() !== finalAuthority.toLowerCase()) {
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Ephemeral wallet address does not match auth chain final authority'
              })
            }

            // Verify that the user making the request is the same as the one who signed the identity
            const requestSender = req.auth
            if (!requestSender || requestSender.toLowerCase() !== identitySender.toLowerCase()) {
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Request sender does not match identity owner'
              })
            }

            const wallet = new ethers.Wallet(identity.ephemeralIdentity.privateKey)

            if (wallet.address.toLowerCase() !== identity.ephemeralIdentity.address.toLowerCase()) {
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Ephemeral private key does not match the provided address'
              })
            }
          } catch (e) {
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: isErrorWithMessage(e) ? e.message : 'Unknown error'
            })
          }

          const identityId = uuid()
          // Use the expiration from the identity, or default to 15 minutes
          const expiration = identity.expiration || new Date(Date.now() + FIFTEEN_MINUTES_IN_MILLISECONDS)

          storage.setIdentity(identityId, {
            identityId,
            identity,
            expiration,
            createdAt: new Date()
          })

          sendResponse<IdentityResponse>(res, 201, {
            identityId,
            expiration
          })
        } catch (e) {
          return sendResponse<InvalidResponseMessage>(res, 400, {
            error: isErrorWithMessage(e) ? e.message : 'Unknown error'
          })
        }
      }
    )

    // identities validation endpoint - returns identity for auto-login
    app.get('/identities/:id', async (req: Request, res: Response) => {
      const identityId = req.params.id

      if (!validateIdentityId(identityId)) {
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: 'Invalid identity format'
        })
      }

      const identity = storage.getIdentity(identityId)

      if (!identity) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: 'Identity not found'
        })
      }

      if (identity.expiration < new Date()) {
        storage.deleteIdentity(identityId)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: 'Identity has expired'
        })
      }

      try {
        // Delete the identity from the storage
        storage.deleteIdentity(identityId)

        // Return the identity for auto-login
        sendResponse<IdentityIdValidationResponse>(res, 200, {
          identity: identity.identity
        })
      } catch (error) {
        logger.error(`Error serving identity: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
        return sendResponse<InvalidResponseMessage>(res, 500, {
          error: 'Internal server error'
        })
      }
    })

    server = new Server(httpServer, { cors: corsOptions })

    server.on('connection', onConnection)

    httpServer.listen(port)

    logger.log(`Listening on port ${port}`)
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!server) {
      return
    }
    const logger = logs.getLogger('websocket-server')

    logger.log('Stopping socket server...')

    server.off('connection', onConnection)

    await new Promise<void>(resolve => {
      if (server) {
        server.close(() => {
          resolve()
        })
      }
    })
  }

  return {
    start,
    stop
  }
}
