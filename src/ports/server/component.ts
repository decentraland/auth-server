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
  OutcomeResponseMessage
} from './types'
import { validateMessage } from './validations'

export async function createServerComponent({
  config,
  logs,
  storage
}: Pick<AppComponents, 'config' | 'logs' | 'storage'>): Promise<IServerComponent> {
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

      delete sockets[socket.id]
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('message', (socketMsg: any) => {
      logger.log(`[${socket.id}] Message received`)

      try {
        validateMessage(socketMsg)
      } catch (error) {
        logger.log(`[${socket.id}] Invalid Message`)

        socket.emit('message', {
          type: MessageType.INVALID,
          requestId: socketMsg?.requestId ?? '',
          error: (error as Error).message
        } as InvalidResponseMessage)

        return
      }

      const msg = socketMsg as InputMessage

      switch (msg.type) {
        case MessageType.REQUEST: {
          const requestId = uuid()

          storage.setRequest(requestId, {
            requestId: requestId,
            socketId: socket.id,
            ...msg
          })

          socket.emit('message', {
            type: MessageType.REQUEST,
            requestId
          } as RequestResponseMessage)

          break
        }

        case MessageType.RECOVER: {
          const request = storage.getRequest(msg.requestId)

          if (!request) {
            socket.emit('message', {
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" not found`
            } as InvalidResponseMessage)

            break
          }

          socket.emit('message', {
            type: MessageType.RECOVER,
            requestId: msg.requestId,
            method: request.method,
            params: request.params
          } as RecoverResponseMessage)

          break
        }

        case MessageType.OUTCOME: {
          const request = storage.getRequest(msg.requestId)

          if (!request) {
            socket.emit('message', {
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Request with id "${msg.requestId}" not found`
            } as InvalidResponseMessage)

            break
          }

          const storedSocket = sockets[request.socketId]

          if (!storedSocket) {
            socket.emit('message', {
              type: MessageType.INVALID,
              requestId: msg.requestId,
              error: `Socket with id "${request.socketId}" not found`
            } as InvalidResponseMessage)

            break
          }

          storedSocket.emit('message', {
            type: MessageType.OUTCOME,
            requestId: msg.requestId,
            result: msg.result
          } as OutcomeResponseMessage)

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
