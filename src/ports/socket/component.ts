import { IBaseComponent } from '@well-known-components/interfaces'
import { Server, Socket } from 'socket.io'
import { AppComponents } from '../../types'
import { ISocketComponent } from './types'

export async function createSocketComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<ISocketComponent> {
  const logger = logs.getLogger('socket')
  const socketPort = await config.requireNumber('SOCKET_PORT')

  let server: Server | null = null

  const onConnection = (socket: Socket) => {
    const id = socket.id

    logger.info(`[${id}] Connected`)

    socket.on('message', () => {
      logger.info(`[${id}] Message received`)
    })

    socket.on('disconnect', () => {
      logger.info(`[${id}] Disconnected`)
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
