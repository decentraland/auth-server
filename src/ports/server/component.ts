import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import {
  IServerComponent,
  InvalidResponseMessage,
  MessageType,
  OutcomeMessage,
  OutcomeResponseMessage,
  OutcomeResponseMessageForInput,
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

    const callbackW = <T>(callback: (...args: any[]) => void, msg: T) => {
      callback(msg)
    }

    socket.on(MessageType.REQUEST, (data: any, callback) => {
      let msg: RequestMessage

      try {
        msg = validateRequestMessage(data)
      } catch (e) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: data?.requestId,
          error: (e as Error).message
        })

        return
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
        chainId: msg.chainId,
        sender: msg.sender
      })

      callbackW<RequestResponseMessage>(callback, {
        type: MessageType.REQUEST,
        requestId,
        expiration,
        code
      })
    })

    socket.on(MessageType.RECOVER, (data: any, callback) => {
      let msg: RecoverMessage

      try {
        msg = validateRecoverMessage(data)
      } catch (e) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: data?.requestId,
          error: (e as Error).message
        })

        return
      }

      const request = storage.getRequest(msg.requestId)

      if (!request) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: msg.requestId,
          error: `Request with id "${msg.requestId}" not found`
        })

        return
      }

      if (request.expiration < new Date()) {
        storage.setRequest(msg.requestId, null)

        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: msg.requestId,
          error: `Request with id "${msg.requestId}" has expired`
        })

        return
      }

      callbackW<RecoverResponseMessage>(callback, {
        type: MessageType.RECOVER,
        requestId: msg.requestId,
        expiration: request.expiration,
        code: request.code,
        method: request.method,
        params: request.params,
        sender: request.sender,
        chainId: request.chainId
      })
    })

    socket.on(MessageType.OUTCOME, (data: any, callback) => {
      let msg: OutcomeMessage

      try {
        msg = validateOutcomeMessage(data)
      } catch (e) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: data?.requestId,
          error: (e as Error).message
        })

        return
      }

      const request = storage.getRequest(msg.requestId)

      if (!request) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: msg.requestId,
          error: `Request with id "${msg.requestId}" not found`
        })

        return
      }

      if (request.expiration < new Date()) {
        storage.setRequest(msg.requestId, null)

        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: msg.requestId,
          error: `Request with id "${msg.requestId}" has expired`
        })

        return
      }

      const storedSocket = sockets[request.socketId]

      if (!storedSocket) {
        callbackW<InvalidResponseMessage>(callback, {
          type: MessageType.INVALID,
          requestId: msg.requestId,
          error: `Socket with id "${request.socketId}" not found`
        })

        return
      }

      storage.setRequest(msg.requestId, null)

      callbackW<OutcomeResponseMessageForInput>(callback, {
        type: MessageType.OUTCOME,
        requestId: msg.requestId
      })

      const outcomeMessage: OutcomeResponseMessage = msg

      storedSocket.emit(MessageType.OUTCOME, outcomeMessage)
    })
  }

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }

    logger.log('Starting socket server...')

    const app = express()
    const httpServer = createServer(app)

    app.get('/health/ready', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/startup', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/live', (_req, res) => {
      res.sendStatus(200)
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
