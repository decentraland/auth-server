import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import { IWebSocketComponent, InitServerMessage, Message, MessageType, SignInClientMessage } from './types'

export async function createWebSocketComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IWebSocketComponent> {
  const logger = logs.getLogger('websocket-server')
  const webSocketPort = await config.requireNumber('HTTP_SERVER_PORT')
  const corsOrigin = await config.requireString('CORS_ORIGIN')
  const corsMethods = await config.requireString('CORS_METHODS')
  const socketByRequestId = new Map<string, Socket>()

  let server: Server | null = null

  const onConnection = (socket: Socket) => {
    const connectedSocketId = socket.id

    logger.log(`[${connectedSocketId}] Connected`)

    socket.on('message', (message: Message) => {
      logger.log(`[${connectedSocketId}] Message received`)

      switch (message.type) {
        case MessageType.INIT: {
          const requestId = uuid()
          socketByRequestId.set(requestId, socket)
          const serverMessage: InitServerMessage = { type: MessageType.INIT, payload: { requestId } }

          socket.emit('message', serverMessage)
          break
        }

        case MessageType.SIGN_IN: {
          const { payload } = message as SignInClientMessage
          const { requestId } = payload
          const targetSocket = socketByRequestId.get(requestId)

          if (!targetSocket) {
            logger.error(`[${connectedSocketId}] Socket for request id ${requestId} not found`)
            return
          }

          targetSocket.emit('message', message)
          socketByRequestId.delete(requestId)
          break
        }
      }
    })

    socket.on('disconnect', () => {
      logger.log(`[${connectedSocketId}] Disconnected`)
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

    httpServer.listen(webSocketPort)

    logger.log(`Listening on port ${webSocketPort}`)
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
