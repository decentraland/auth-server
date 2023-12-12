import { RequestMessage } from '../server/types'

export type IStorageComponent = {
  getMessage(requestId: string): RequestMessage['payload'] | null
  setMessage(requestId: string, message: RequestMessage['payload']): void
  getSocketId(requestId: string): string | null
  setSocketId(requestId: string, socketId: string): void
}
