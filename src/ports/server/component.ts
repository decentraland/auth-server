import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import {
  IServerComponent,
  InputMessage,
  MessageType,
  RecoverResponseMessage,
  RequestResponseMessage,
  InvalidResponseMessage,
  OutcomeResponseMessage,
  ResponseMessage,
  OutcomeResponseMessageForInput
} from './types'
import { validateMessage } from './validations'

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('message', (socketMsg: any) => {
      logger.log(`[${socket.id}] Message received`)

      const emit = <T extends ResponseMessage>(msg: T, _socket: Socket = socket) => {
        logger.log(`[${_socket.id}] Sending Message`)

        _socket.emit('message', msg)
      }

      try {
        validateMessage(socketMsg)
      } catch (error) {
        logger.log(`[${socket.id}] Invalid Message`)

        emit<InvalidResponseMessage>({
          type: MessageType.INVALID,
          requestId: socketMsg?.requestId ?? '',
          error: (error as Error).message
        })

        return
      }

      const msg = socketMsg as InputMessage

      switch (msg.type) {
        case MessageType.REQUEST: {
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

          emit<RequestResponseMessage>({
            type: MessageType.REQUEST,
            requestId,
            expiration,
            code
          })

          break
        }

        case MessageType.RECOVER: {
          const request = storage.getRequest(msg.requestId)

          if (!request) {
            emit<InvalidResponseMessage>({
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" not found`
            })

            break
          }

          if (request.expiration < new Date()) {
            storage.setRequest(msg.requestId, null)

            emit<InvalidResponseMessage>({
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" has expired`
            })

            break
          }

          emit<RecoverResponseMessage>({
            type: MessageType.RECOVER,
            requestId: msg.requestId,
            expiration: request.expiration,
            code: request.code,
            method: request.method,
            params: request.params,
            sender: request.sender,
            chainId: request.chainId
          })

          break
        }

        case MessageType.OUTCOME: {
          const request = storage.getRequest(msg.requestId)

          if (!request) {
            emit<InvalidResponseMessage>({
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" not found`
            })

            break
          }

          if (request.expiration < new Date()) {
            storage.setRequest(msg.requestId, null)

            emit<InvalidResponseMessage>({
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" has expired`
            })

            break
          }

          const storedSocket = sockets[request.socketId]

          if (!storedSocket) {
            emit<InvalidResponseMessage>({
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Socket with id "${request.socketId}" not found`
            })

            break
          }

          storage.setRequest(msg.requestId, null)

          emit<OutcomeResponseMessageForInput>({
            type: MessageType.OUTCOME,
            requestId: msg.requestId
          })

          emit<OutcomeResponseMessage>(msg, storedSocket)

          break
        }
      }
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
