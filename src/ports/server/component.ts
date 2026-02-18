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
import { METHOD_DCL_PERSONAL_SIGN, FIFTEEN_MINUTES_IN_MILLISECONDS, MAX_BODY_SIZE } from './constants'
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
  metrics,
  storage,
  tracer,
  requestExpirationInSeconds,
  dclPersonalSignExpirationInSeconds
}: Pick<AppComponents, 'config' | 'logs' | 'metrics' | 'storage' | 'tracer'> & {
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

  // Metrics configuration
  const metricsPath = (await config.getString('WKC_METRICS_PUBLIC_PATH')) || '/metrics'
  const metricsBearerToken = await config.getString('WKC_METRICS_BEARER_TOKEN')

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
          async () => {
            logger.log('Disconnected')

            const requestId = await storage.getRequestIdForSocketId(socket.id)

            if (requestId) {
              const request = await storage.getRequest(requestId)
              // Only delete unfulfilled (orphaned) requests — fulfilled ones should persist until expiration
              if (!request?.fulfilled) {
                storage.setRequest(requestId, null)
              }
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

            storage.setRequest(requestId, {
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
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.RECOVER, (data: any, cb) =>
        tracer.span(
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
              storage.setRequest(msg.requestId, null)

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
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.on(MessageType.OUTCOME, (data: any, cb) =>
        tracer.span(
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

              // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
              storage.setRequest(msg.requestId, {
                requestId: msg.requestId,
                socketId: request.socketId,
                fulfilled: true,
                expiration: request.expiration,
                code: 0,
                method: '',
                params: [],
                requiresValidation: false
              })

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
              logger.log(`[RID:${msg.requestId}] Tried to communicate that the request must be validated but it has already been fulfilled`)
              return ack<InvalidResponseMessage>(cb, {
                error: `Request with id "${msg.requestId}" has already been fulfilled`
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
    const identityLogger = logs.getLogger('identity-endpoints')

    logger.log('Starting socket server...')

    const app = express()
    const httpServer = createServer(app)

    // Middleware to parse JSON in the request body
    app.use(bodyParser.json({ limit: MAX_BODY_SIZE }))
    app.use(cors(corsOptions))

    // Request tracking middleware
    app.use((req, res, next) => {
      if (req.path === metricsPath) {
        return next()
      }

      const labels = {
        method: req.method,
        handler: '',
        code: 200
      }

      const startTimerResult = metrics.startTimer('http_request_duration_seconds', labels)
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const end = startTimerResult?.end || (() => {})

      res.on('finish', () => {
        labels.code = res.statusCode
        if (req.route?.path) {
          labels.handler = req.baseUrl + req.route.path
        }

        const contentLength = parseInt(req.get('content-length') || '0', 10) || 0
        metrics.observe('http_request_size_bytes', labels, contentLength)
        metrics.increment('http_requests_total', labels)
        end(labels)
      })

      next()
    })

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

    // Helper function to normalize IP address (convert IPv6-mapped IPv4 to IPv4)
    const normalizeIp = (ip: string): string => {
      // Convert IPv6-mapped IPv4 (::ffff:xxx.xxx.xxx.xxx) to IPv4
      if (ip.startsWith('::ffff:')) {
        return ip.substring(7)
      }
      return ip.trim()
    }

    // Helper function to get client IP address from request
    // Prioritizes trusted headers (True-Client-IP, X-Real-IP, Cloudflare's CF-Connecting-IP) over X-Forwarded-For
    const getClientIp = (req: Request): string => {
      // Check True-Client-IP header (set by proxies like Cloudflare, contains the visitor's IP address)
      const trueClientIp = req.headers['true-client-ip']
      if (trueClientIp) {
        const ip = Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp
        return normalizeIp(ip)
      }

      // Check X-Real-IP header (set by proxies when configured, more trustworthy than X-Forwarded-For)
      const xRealIp = req.headers['x-real-ip']
      if (xRealIp) {
        const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp
        return normalizeIp(ip)
      }

      // Check CF-Connecting-IP header first (Cloudflare's trusted header, cannot be spoofed)
      const cfConnectingIp = req.headers['cf-connecting-ip']
      if (cfConnectingIp) {
        const ip = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp
        return normalizeIp(ip)
      }

      // Check X-Forwarded-For header (can be spoofed, use with caution)
      // Take the first IP in the chain (original client)
      const xForwardedFor = req.headers['x-forwarded-for']
      if (xForwardedFor) {
        const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor.split(',')[0]
        return normalizeIp(ips)
      }

      // Fallback to req.ip (requires express trust proxy configuration) or connection remote address
      const fallbackIp = req.ip || req.socket.remoteAddress || 'unknown'
      return normalizeIp(fallbackIp)
    }

    // Helper function to check if two IPs match, considering subnet/region matching
    // For IPv4, this can match by subnet (e.g., 10.0.16.* matches 10.0.16.*)
    const ipsMatch = (ip1: string, ip2: string): boolean => {
      if (!ip1 || !ip2 || ip1 === 'unknown' || ip2 === 'unknown') {
        return false
      }

      // Exact match
      if (ip1 === ip2) {
        return true
      }

      // Normalize both IPs
      const normalizedIp1 = normalizeIp(ip1)
      const normalizedIp2 = normalizeIp(ip2)

      // Exact match after normalization
      if (normalizedIp1 === normalizedIp2) {
        return true
      }

      // IPv4 subnet matching: check if they're in the same /24 subnet (first 3 octets)
      // This helps with VPNs that might use different edge servers but same region
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
      const match1 = normalizedIp1.match(ipv4Regex)
      const match2 = normalizedIp2.match(ipv4Regex)

      if (match1 && match2) {
        // Match by /24 subnet (first 3 octets)
        if (match1[1] === match2[1] && match1[2] === match2[2] && match1[3] === match2[3]) {
          return true
        }
      }

      return false
    }

    // Helper function to format IP-related headers for logging
    const formatIpHeaders = (req: Request): string => {
      return `true-client-ip=${req.headers['true-client-ip']}, x-real-ip=${req.headers['x-real-ip']}, cf-connecting-ip=${req.headers['cf-connecting-ip']}, x-forwarded-for=${req.headers['x-forwarded-for']}`
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

      storage.setRequest(requestId, {
        requestId: requestId,
        expiration,
        code,
        method: msg.method,
        params: msg.params,
        sender: sender?.toLowerCase(),
        requiresValidation: false
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
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
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

      const request = await storage.getRequest(requestId)

      if (!request) {
        logger.log(`[RID:${requestId}] Received a validation request message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        logger.log(`[RID:${requestId}] Received a validation request message for an already fulfilled request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
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
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
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
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
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

      // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
      storage.setRequest(requestId, {
        requestId,
        fulfilled: true,
        expiration: request.expiration,
        code: 0,
        method: '',
        params: [],
        requiresValidation: false
      })
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

      const request = await storage.getRequest(requestId)

      if (!request) {
        logger.log(`[RID:${requestId}] Received an outcome message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        logger.log(`[RID:${requestId}] Received an outcome message for an already fulfilled request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
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
        // Mark as fulfilled instead of deleting — allows frontend to distinguish "consumed" from "never existed"
        storage.setRequest(requestId, {
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
        identityLogger.log('Received a request to create identity')
        try {
          const { identity, isMobile } = validateIdentityRequest(req.body)

          if (!identity) {
            identityLogger.log('Received a request to create identity without AuthIdentity in body')
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: 'AuthIdentity is required in request body'
            })
          }

          // Validate auth chain using the same logic as /requests endpoint
          try {
            const { sender: identitySender, finalAuthority } = await validateAuthChain(identity.authChain)
            // Verify that the ephemeral wallet address matches the finalAuthority from auth chain
            if (identity.ephemeralIdentity.address.toLowerCase() !== finalAuthority.toLowerCase()) {
              identityLogger.log(`Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender}`)
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Ephemeral wallet address does not match auth chain final authority'
              })
            }

            // Verify that the user making the request is the same as the one who signed the identity
            const requestSender = req.auth
            if (!requestSender || requestSender.toLowerCase() !== identitySender.toLowerCase()) {
              identityLogger.log(`Request sender (${requestSender}) does not match identity owner (${identitySender})`)
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Request sender does not match identity owner'
              })
            }

            const wallet = new ethers.Wallet(identity.ephemeralIdentity.privateKey)

            if (wallet.address.toLowerCase() !== identity.ephemeralIdentity.address.toLowerCase()) {
              identityLogger.log(`Ephemeral private key does not match the provided address for sender: ${identitySender}`)
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: 'Ephemeral private key does not match the provided address'
              })
            }
          } catch (e) {
            const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'
            identityLogger.log(`Received a request to create identity with invalid auth chain: ${errorMessage}`)
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: errorMessage
            })
          }

          const identityId = uuid()
          // Always use 15 minutes expiration for storage (controls when identity is removed from storage)
          const storageExpiration = new Date(Date.now() + FIFTEEN_MINUTES_IN_MILLISECONDS)
          const clientIp = getClientIp(req)

          storage.setIdentity(identityId, {
            identityId,
            identity,
            expiration: storageExpiration,
            createdAt: new Date(),
            ipAddress: clientIp,
            isMobile: isMobile === true
          })

          identityLogger.log(
            `[IID:${identityId}][EXP:${storageExpiration.getTime()}][Mobile:${
              isMobile === true
            }] Successfully created identity from IP: ${clientIp}. Headers: ${formatIpHeaders(req)}`
          )

          sendResponse<IdentityResponse>(res, 201, {
            identityId,
            expiration: storageExpiration
          })
        } catch (e) {
          const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'
          identityLogger.log(`Received a request to create identity with invalid message: ${errorMessage}`)
          return sendResponse<InvalidResponseMessage>(res, 400, {
            error: errorMessage
          })
        }
      }
    )

    // identities validation endpoint - returns identity for auto-login
    app.get('/identities/:id', async (req: Request, res: Response) => {
      const identityId = req.params.id
      identityLogger.log(`Received a request to retrieve identity: ${identityId}`)

      if (!validateIdentityId(identityId)) {
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve identity with invalid format`)
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: 'Invalid identity format'
        })
      }

      const identity = await storage.getIdentity(identityId)

      if (!identity) {
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve a non-existent identity`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: 'Identity not found'
        })
      }

      if (identity.expiration < new Date()) {
        storage.deleteIdentity(identityId)
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve an expired identity`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: 'Identity has expired'
        })
      }

      // Validate that the IP address matches the one used when creating the identity
      // Uses flexible matching to handle Cloudflare and VPN edge server differences
      const clientIp = getClientIp(req)

      if (identity.isMobile) {
        // Log header details if IPs differ (for debugging), but allow the request
        if (!ipsMatch(identity.ipAddress, clientIp)) {
          identityLogger.log(
            `[IID:${identityId}] Mobile IP mismatch (allowed). Stored: ${
              identity.ipAddress
            }, Request: ${clientIp}. Headers: ${formatIpHeaders(req)}`
          )
        }
        // Continue without blocking for mobile
      } else if (!ipsMatch(identity.ipAddress, clientIp)) {
        // Non-mobile: delete identity and return 403
        storage.deleteIdentity(identityId)
        identityLogger.log(
          `[IID:${identityId}] Received a request to retrieve identity from different IP. Stored: ${identity.ipAddress}, Request: ${clientIp}. Identity deleted.`
        )
        return sendResponse<InvalidResponseMessage>(res, 403, {
          error: 'IP address mismatch'
        })
      }

      try {
        // Delete the identity from the storage
        storage.deleteIdentity(identityId)

        identityLogger.log(`[IID:${identityId}][EXP:${identity.expiration.getTime()}] Successfully served identity to IP: ${clientIp}`)

        // Return the identity for auto-login
        sendResponse<IdentityIdValidationResponse>(res, 200, {
          identity: identity.identity
        })
      } catch (error) {
        const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
        identityLogger.error(`[IID:${identityId}] Error serving identity: ${errorMessage}`)
        return sendResponse<InvalidResponseMessage>(res, 500, {
          error: 'Internal server error'
        })
      }
    })

    // PROM metrics endpoint
    app.get(metricsPath, async (req: Request, res: Response) => {
      if (metricsBearerToken) {
        const authHeader = req.headers['authorization']
        if (!authHeader) {
          res.sendStatus(401)
          return
        }
        const [, token] = authHeader.split(' ')
        if (token !== metricsBearerToken) {
          res.sendStatus(401)
          return
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (metrics as any).registry
      if (!registry) {
        res.sendStatus(500)
        return
      }

      const body = await registry.metrics()
      res.set('content-type', registry.contentType)
      res.status(200).send(body)
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
