import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import {
  IServerComponent,
  Message,
  MessageType,
  RecoverResponseMessage,
  RequestResponseMessage,
  SubmitSignatureResponseMessage
} from './types'

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

    socket.on('message', (message: Message) => {
      logger.log(`[${socket.id}] Message received`)

      switch (message.type) {
        case MessageType.REQUEST: {
          const requestId = uuid()

          storage.setSocketId(requestId, socket.id)
          storage.setMessage(requestId, message.payload)

          socket.emit('message', {
            type: MessageType.REQUEST_RESPONSE,
            payload: {
              ok: true,
              requestId
            }
          } as RequestResponseMessage)

          break
        }

        case MessageType.RECOVER: {
          const { requestId } = message.payload

          const storageMessage = storage.getMessage(requestId)

          if (!storageMessage) {
            socket.emit('message', {
              type: MessageType.RECOVER_RESPONSE,
              payload: {
                ok: false,
                requestId,
                error: `Message for request with id "${requestId}" not found`
              }
            } as RecoverResponseMessage)

            break
          }

          socket.emit('message', {
            type: MessageType.RECOVER_RESPONSE,
            payload: {
              ok: true,
              requestId,
              ...storageMessage
            }
          } as RecoverResponseMessage)

          break
        }

        case MessageType.SUBMIT_SIGNATURE: {
          const { requestId, signature, signer } = message.payload

          const storageSocketId = storage.getSocketId(requestId)

          if (!storageSocketId) {
            socket.emit('message', {
              type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
              payload: {
                ok: false,
                requestId,
                error: `Socket Id for request with id "${requestId}" not found`
              }
            } as SubmitSignatureResponseMessage)

            break
          }

          const storageSocket = sockets[storageSocketId]

          if (!storageSocket) {
            socket.emit('message', {
              type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
              payload: {
                ok: false,
                requestId,
                error: `Socket for socket with id "${storageSocketId}" not found`
              }
            } as SubmitSignatureResponseMessage)

            break
          }

          storageSocket.emit('message', {
            type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
            payload: {
              ok: true,
              requestId,
              signature,
              signer
            }
          } as SubmitSignatureResponseMessage)

          break
        }

        default: {
          logger.log(`[${socket.id}] Unknown message type: ${message.type}`)
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
