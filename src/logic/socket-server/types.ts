import { IBaseComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { Socket } from 'socket.io'
import { MessageType } from '../../ports/server/types'
import { IStorageComponent } from '../../ports/storage/types'

export type ISocketServerComponent = IBaseComponent & {
  /**
   * Emits a message to the socket identified by `socketId` if it is still
   * connected. Returns `true` if the socket existed and the message was sent,
   * `false` otherwise. Used by the HTTP handlers to relay outcomes / validation
   * notifications to a connected client.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitToSocket(socketId: string, type: MessageType, message: any): boolean
  /**
   * Returns `true` if a socket with the given id is currently connected.
   */
  isSocketConnected(socketId: string): boolean
}

/**
 * Context passed to every socket message handler — the socket analog of the HTTP HandlerContext.
 */
export type SocketHandlerContext = {
  components: {
    storage: IStorageComponent
    logs: ILoggerComponent
  }
  /** The connected client whose message is being handled; its id is stored as the request's socketId. */
  socket: Socket
  /** Emits to a (possibly different) connected socket by id; returns false if it is not connected. */
  emitToSocket: (socketId: string, type: MessageType, message: unknown) => boolean
  /** Returns true if the socket with the given id is currently connected. */
  isSocketConnected: (socketId: string) => boolean
}

/**
 * A socket message handler — the analog of an HTTP handler. It validates the raw payload and
 * returns the value to ack back to the client (an error payload for expected/validation failures).
 * Throwing is reserved for unexpected errors, which the connection wrapper reports to Sentry and
 * acks as a generic error — mirroring how HTTP handlers return a response and the errorHandler
 * middleware maps thrown errors.
 */
export type SocketMessageHandler = (context: SocketHandlerContext, data: unknown) => Promise<unknown>

/**
 * Binds a socket event (message type) to its handler and a tracing span name — the socket analog
 * of an HTTP route.
 */
export type SocketRoute = {
  event: MessageType
  span: string
  handle: SocketMessageHandler
}
