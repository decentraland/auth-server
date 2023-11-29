import { IBaseComponent } from '@well-known-components/interfaces'
import { Server, Socket } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { AppComponents } from '../../types'
import { ISocketComponent, InitServerMessage, Message, MessageType, SignInClientMessage } from './types'

export async function createSocketComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<ISocketComponent> {
  const logger = logs.getLogger('socket')
  const socketPort = await config.requireNumber('SOCKET_PORT')
  const socketByRequestId = new Map<string, Socket>()

  let server: Server | null = null

  const onConnection = (socket: Socket) => {
    const connectedSocketId = socket.id

    logger.info(`[${connectedSocketId}] Connected`)

    socket.on('message', (message: Message) => {
      logger.info(`[${connectedSocketId}] Message received`)

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
      logger.info(`[${connectedSocketId}] Disconnected`)
    })
  }

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }

    logger.info('Starting socket server...')

    server = new Server({
      cors: {
        origin: '*'
      }
    })

    server.on('connection', onConnection)

    server.listen(socketPort)

    logger.info(`Listening on port ${socketPort}`)
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!server) {
      return
    }

    logger.info('Stopping socket server...')

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
