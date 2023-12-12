import { RequestMessage } from '../server/types'
import { IStorageComponent } from './types'

export function createStorageComponent(): IStorageComponent {
  const messages: Record<string, RequestMessage['payload']> = {}
  const socketIds: Record<string, string> = {}

  // Messages

  const getMessage = (requestId: string) => {
    return messages[requestId] ?? null
  }

  const setMessage = (requestId: string, message: RequestMessage['payload']) => {
    messages[requestId] = message
  }

  // Sockets

  const getSocketId = (requestId: string) => {
    return socketIds[requestId] ?? null
  }

  const setSocketId = (requestId: string, socketId: string) => {
    socketIds[requestId] = socketId
  }

  return {
    getMessage,
    setMessage,
    getSocketId,
    setSocketId
  }
}
