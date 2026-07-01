import { IBaseComponent } from '@well-known-components/interfaces'
import { MessageType } from '../../ports/server/types'

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
