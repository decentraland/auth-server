import { Message } from '../server/types'

export type IStorageComponent = {
  getMessage(requestId: string): Message | null
  setMessage(requestId: string, message: Message): void
  getSocketId(requestId: string): string | null
  setSocketId(requestId: string, socketId: string): void
}
