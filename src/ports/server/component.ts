import { createServer } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import express from 'express'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import {
  IServerComponent,
  InvalidResponseMessage,
  Message,
  MessageType,
  RecoverResponseMessage,
  RequestResponseMessage,
  SubmitSignatureResponseMessage
} from './types'
import { validateMessage, validateRecoverMessage, validateRequestMessage, validateSubmitSignatureMessage } from './validations'

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

    socket.on('message', (socketMsg: any) => {
      logger.log(`[${socket.id}] Message received`)

      try {
        validateMessage(socketMsg)
      } catch (error) {
        logger.log(`[${socket.id}] Message does not have the expected base format: ${(error as Error).message}`)

        socket.emit('message', {
          type: MessageType.INVALID_RESPONSE,
          payload: {
            ok: false,
            requestId: socketMsg?.payload?.requestId,
            error: (error as Error).message
          }
        } as InvalidResponseMessage)

        return
      }

      const msg = socketMsg as Message

      switch (msg.type) {
        case MessageType.REQUEST: {
          try {
            validateRequestMessage(msg)
          } catch (error) {
            socket.emit('message', {
              type: MessageType.REQUEST_RESPONSE,
              payload: {
                ok: false,
                error: (error as Error).message
              }
            } as RequestResponseMessage)

            break
          }

          const requestId = uuid()

          storage.setSocketId(requestId, socket.id)
          storage.setMessage(requestId, msg.payload)

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
          try {
            validateRecoverMessage(msg)
          } catch (error) {
            socket.emit('message', {
              type: MessageType.RECOVER_RESPONSE,
              payload: {
                ok: false,
                requestId: msg.payload?.requestId,
                error: (error as Error).message
              }
            } as RecoverResponseMessage)

            break
          }

          const { requestId } = msg.payload

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
          try {
            validateSubmitSignatureMessage(msg)
          } catch (error) {
            socket.emit('message', {
              type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
              payload: {
                ok: false,
                requestId: msg.payload?.requestId,
                error: (error as Error).message
              }
            } as SubmitSignatureResponseMessage)

            break
          }

          const { requestId, signature, signer } = msg.payload

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
          logger.log(`[${socket.id}] Unknown message type: ${msg.type}`)
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
