import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import { ClientMessage, IServerComponent, Message, MessageType, ServerMessage } from './types'

export async function createServerComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IServerComponent> {
  const logger = logs.getLogger('websocket-server')
  const port = await config.requireNumber('HTTP_SERVER_PORT')
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
          const serverMessage: ServerMessage.Init = { type: MessageType.INIT, payload: { requestId } }
          socket.emit('message', serverMessage)
          break
        }

        case MessageType.SIGNATURE: {
          const { payload } = message as ClientMessage.Signature
          const { requestId } = payload
          const targetSocket = socketByRequestId.get(requestId)

          if (!targetSocket) {
            logger.error(`[${connectedSocketId}] Socket for request id ${requestId} not found`)
            return
          }

          socketByRequestId.delete(requestId)
          const serverMessage: ServerMessage.Signature = message as ServerMessage.Signature
          targetSocket.emit('message', serverMessage)
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
