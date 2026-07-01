import { Server as HttpServer } from 'http'
import * as Sentry from '@sentry/node'
import { IBaseComponent } from '@well-known-components/interfaces'
import { Server, Socket } from 'socket.io'
import { getUnderlyingServer } from '@dcl/http-server'
import { InvalidResponseMessage } from '../../ports/server/types'
import { AppComponents } from '../../types'
import { isErrorWithMessage } from '../error-handling'
import { getSocketRoutes } from './routes'
import { ISocketServerComponent, SocketHandlerContext } from './types'

export type SocketServerOptions = {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
  cors: {
    origin: RegExp[]
    methods: string
  }
}

export async function createSocketServerComponent(
  { logs, storage, tracer, server }: Pick<AppComponents, 'logs' | 'storage' | 'tracer' | 'server'>,
  { requestExpirationInSeconds, dclPersonalSignExpirationInSeconds, cors }: SocketServerOptions
): Promise<ISocketServerComponent> {
  const logger = logs.getLogger('websocket-server')

  const sockets: Record<string, Socket> = {}

  let io: Server | null = null

  const emitToSocket: ISocketServerComponent['emitToSocket'] = (socketId, type, message) => {
    const storedSocket = sockets[socketId]
    if (!storedSocket) {
      return false
    }
    storedSocket.emit(type, message)
    return true
  }

  const isSocketConnected: ISocketServerComponent['isSocketConnected'] = socketId => !!sockets[socketId]

  // Socket message handlers bound to their events + tracing spans — the socket analog of the HTTP router.
  const routes = getSocketRoutes({ requestExpirationInSeconds, dclPersonalSignExpirationInSeconds })

  const onConnection = (socket: Socket) =>
    tracer.span('websocket-connection', () => {
      logger.log('Connected')
      sockets[socket.id] = socket

      const parentTracingContext = tracer.getTrace()

      socket.on('disconnect', () =>
        tracer.span(
          'websocket-disconnect',
          () => {
            logger.log('Disconnected')
            // Don't delete requests on disconnect — let them expire naturally via TTL.
            // This prevents the race condition where the user is still completing
            // the auth flow when the game client's socket temporarily disconnects.
            delete sockets[socket.id]
          },
          parentTracingContext
        )
      )

      // Wraps the callback function on messages to type the message that is being sent.
      // On the client, the response will be received using socket.emitWithAck().
      const ack = <T>(cb: (...args: unknown[]) => void, msg: T) =>
        tracer.span(
          'websocket-ack',
          () => {
            try {
              cb(msg)
            } catch (e) {
              // This might happen if the request was done with socket.emit instead of socket.emitWithAck.
              logger.error(`There was an error sending the response message: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
            }
          },
          parentTracingContext
        )

      const handlerContext: SocketHandlerContext = {
        components: { storage, logs },
        socket,
        emitToSocket,
        isSocketConnected
      }

      // Register each socket message handler with shared tracing / ack / error handling — the socket
      // analog of `server.use(router.middleware())`. A handler returns the payload to ack; an
      // unexpected throw is reported to Sentry and acked as a generic error.
      for (const route of routes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.on(route.event, async (data: any, cb) =>
          tracer
            .span(
              route.span,
              async () => {
                const response = await route.handle(handlerContext, data)
                ack(cb, response)
              },
              parentTracingContext
            )
            .catch(e => {
              Sentry.captureException(e)
              logger.error(`Unexpected error in ${route.event} handler: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
              ack<InvalidResponseMessage>(cb, { error: 'Internal server error' })
            })
        )
      }
    })

  const start: IBaseComponent['start'] = async () => {
    if (io) {
      return
    }

    logger.log('Starting socket server...')

    // The @dcl/http-server is already listening at this point (startComponents ran the
    // http-server's lifecycle first). Attach socket.io to its underlying Node http.Server so
    // socket.io owns the `/socket.io/*` namespace and the HTTP `upgrade` event, while the
    // http-server keeps handling every other request.
    const httpServer = await getUnderlyingServer<HttpServer>(server)

    io = new Server(httpServer, { cors })
    io.on('connection', onConnection)

    logger.log('Socket server attached to the HTTP server')
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!io) {
      return
    }

    logger.log('Stopping socket server...')

    const currentIo = io

    currentIo.off('connection', onConnection)

    // Detach socket.io WITHOUT closing the underlying HTTP server: the http-server component owns
    // that server's lifecycle. socket.io's own `close()` would call `httpServer.close()`, a double
    // close on top of the http-server's terminator (→ `ERR_SERVER_NOT_RUNNING`). Instead, disconnect
    // every client and close the engine; the http-server component then shuts the server down cleanly.
    currentIo.disconnectSockets(true)
    currentIo.engine.close()

    io = null

    for (const socketId of Object.keys(sockets)) {
      delete sockets[socketId]
    }
  }

  return {
    start,
    stop,
    emitToSocket,
    isSocketConnected
  }
}
