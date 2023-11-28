import { IBaseComponent } from '@well-known-components/interfaces'
import { Server, Socket } from 'socket.io'
import { AppComponents } from '../../types'
import { ISocketComponent } from './types'

export async function createSocketComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<ISocketComponent> {
  const logger = logs.getLogger('socket')
  const socketPort = await config.requireNumber('SOCKET_PORT')
  const clients: Record<string, Socket> = {}

  let server: Server | null = null

  const onConnection = (socket: Socket) => {
    const id = socket.id

    logger.info(`Client with id ${id} connected`)

    clients[id] = socket

    socket.on('message', () => {
      logger.info(`Received a message from client with id ${id}`)
    })

    socket.on('disconnect', () => {
      logger.info(`Client with id ${id} disconnected`)

      delete clients[id]
    })
  }

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }

    logger.info('Starting socket server...')

    server = new Server({})

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
