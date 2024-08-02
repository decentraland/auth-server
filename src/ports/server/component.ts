import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Request, Response } from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AppComponents } from '../../types'
import { METHOD_DCL_PERSONAL_SIGN } from './constants'
import {
  IServerComponent,
  InvalidResponseMessage,
  MessageType,
  OutcomeMessage,
  OutcomeResponseMessage,
  RecoverMessage,
  RecoverResponseMessage,
  RequestMessage,
  RequestResponseMessage
} from './types'
import { validateOutcomeMessage, validateRecoverMessage, validateRequestMessage } from './validations'

export async function createServerComponent({
  config,
  logs,
  storage,
  requestExpirationInSeconds
}: Pick<AppComponents, 'config' | 'logs' | 'storage'> & { requestExpirationInSeconds: number }): Promise<IServerComponent> {
  const logger = logs.getLogger('websocket-server')
  const port = await config.requireNumber('HTTP_SERVER_PORT')
  const corsOrigin = await config.requireString('CORS_ORIGIN')
  const corsMethods = await config.requireString('CORS_METHODS')

  const sockets: Record<string, Socket> = {}

  let server: Server | null = null

  const onConnection = (socket: Socket) => {
    logger.log(`[${socket.id}] Connected`)

    sockets[socket.id] = socket

    socket.on('disconnect', () => {
      logger.log(`[${socket.id}] Disconnected`)

      const requestId = storage.getRequestIdForSocketId(socket.id)

      if (requestId) {
        storage.setRequest(requestId, null)
      }

      delete sockets[socket.id]
    })

    // Wraps the callback function on messages to type the message that is being sent.
    // On the client, the response will be received using socket.emitWithAck().
    const ack = <T>(cb: (...args: unknown[]) => void, msg: T) => {
      try {
        cb(msg)
      } catch (e) {
        // This might happen if the request was done with socket.emit instead of socket.emitWithAck.
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(MessageType.REQUEST, async (data: any, cb) => {
      let msg: RequestMessage

      try {
        msg = validateRequestMessage(data)
      } catch (e) {
        ack<InvalidResponseMessage>(cb, {
          error: (e as Error).message
        })

        return
      }

      let sender: string | undefined

      if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
        const authChain = msg.authChain

        if (!authChain) {
          ack<InvalidResponseMessage>(cb, {
            error: 'Auth chain is required'
          })

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

          return
        }

        const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

        if (!validationResult.ok) {
          ack<InvalidResponseMessage>(cb, {
            error: validationResult.message ?? 'Signature validation failed'
          })

          return
        }
      }

      const requestId = uuid()
      const expiration = new Date(Date.now() + requestExpirationInSeconds * 1000)
      const code = Math.floor(Math.random() * 100)

      storage.setRequest(requestId, {
        requestId: requestId,
        socketId: socket.id,
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
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(MessageType.RECOVER, (data: any, cb) => {
      let msg: RecoverMessage

      try {
        msg = validateRecoverMessage(data)
      } catch (e) {
        ack<InvalidResponseMessage>(cb, {
          error: (e as Error).message
        })

        return
      }

      const request = storage.getRequest(msg.requestId)

      if (!request) {
        ack<InvalidResponseMessage>(cb, {
          error: `Request with id "${msg.requestId}" not found`
        })

        return
      }

      if (request.expiration < new Date()) {
        storage.setRequest(msg.requestId, null)

        ack<InvalidResponseMessage>(cb, {
          error: `Request with id "${msg.requestId}" has expired`
        })

        return
      }

      ack<RecoverResponseMessage>(cb, {
        expiration: request.expiration,
        code: request.code,
        method: request.method,
        params: request.params,
        sender: request.sender
      })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(MessageType.OUTCOME, (data: any, cb) => {
      let msg: OutcomeMessage

      try {
        msg = validateOutcomeMessage(data)
      } catch (e) {
        ack<InvalidResponseMessage>(cb, {
          error: (e as Error).message
        })

        return
      }

      const request = storage.getRequest(msg.requestId)

      // If the response was already received, it's like the request doesn't exist anymore
      if (!request || request.response) {
        ack<InvalidResponseMessage>(cb, {
          error: `Request with id "${msg.requestId}" not found`
        })

        return
      }

      if (request.expiration < new Date()) {
        storage.setRequest(msg.requestId, null)

        ack<InvalidResponseMessage>(cb, {
          error: `Request with id "${msg.requestId}" has expired`
        })

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

          return
        }

        storage.setRequest(msg.requestId, null)

        const outcomeMessage: OutcomeResponseMessage = msg
        storedSocket.emit(MessageType.OUTCOME, outcomeMessage)
      } else {
        request.response = msg
      }
      ack<object>(cb, {})
    })
  }

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }

    logger.log('Starting socket server...')

    const app = express()
    const httpServer = createServer(app)

    // Middleware to parse JSON in the request body
    app.use(bodyParser.json())

    // CORS middleware
    app.use(cors({ origin: corsOrigin, methods: corsMethods }))

    app.get('/health/ready', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/startup', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/live', (_req, res) => {
      res.sendStatus(200)
    })

    // Wraps the callback function on messages to type the message that is being sent
    const sendResponse = <T>(res: Response, statusCode: number, msg: T) => {
      res.status(statusCode).json(msg)
    }

    app.post('/requests', async (req: Request, res: Response) => {
      const data = req.body
      let msg: RequestMessage

      try {
        msg = validateRequestMessage(data)
      } catch (e) {
        sendResponse<InvalidResponseMessage>(res, 400, {
          error: (e as Error).message
        })

        return
      }

      let sender: string | undefined

      if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
        const authChain = msg.authChain

        if (!authChain) {
          sendResponse<InvalidResponseMessage>(res, 400, {
            error: 'Auth chain is required'
          })

          return
        }

        sender = Authenticator.ownerAddress(authChain)

        let finalAuthority: string

        try {
          finalAuthority = parseEmphemeralPayload(authChain[authChain.length - 1].payload).ephemeralAddress
        } catch (e) {
          sendResponse<InvalidResponseMessage>(res, 400, {
            error: 'Could not get final authority from auth chain'
          })

          return
        }

        const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

        if (!validationResult.ok) {
          sendResponse<InvalidResponseMessage>(res, 400, {
            error: validationResult.message ?? 'Signature validation failed'
          })

          return
        }
      }

      const requestId = uuid()
      const expiration = new Date(Date.now() + requestExpirationInSeconds * 1000)
      const code = Math.floor(Math.random() * 100)

      storage.setRequest(requestId, {
        requestId: requestId,
        expiration,
        code,
        method: msg.method,
        params: msg.params,
        sender: sender?.toLowerCase()
      })

      sendResponse<RequestResponseMessage>(res, 201, {
        requestId,
        expiration,
        code
      })
    })

    app.get('/requests/:requestId', async (req: Request, res: Response) => {
      const requestId = req.params.requestId
      const request = storage.getRequest(requestId)

      if (!request) {
        sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })

        return
      }

      if (request.expiration < new Date()) {
        storage.setRequest(requestId, null)

        sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })

        return
      }

      if (!request.response) {
        sendResponse<InvalidResponseMessage>(res, 204, {
          error: `Request with id "${requestId}" has not been completed`
        })

        return
      }

      storage.setRequest(requestId, null)

      sendResponse<OutcomeResponseMessage>(res, 200, request.response)
    })

    server = new Server(httpServer, { cors: { origin: corsOrigin, methods: corsMethods } })

    server.on('connection', onConnection)

    httpServer.listen(port)

    logger.log(`Listening on port ${port}`)
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!server) {
      return
    }

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
