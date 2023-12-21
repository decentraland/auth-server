import { RequestMessage } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): Request | null
  setRequest(requestId: string, request: Request | null): void
  getRequestIdForSocketId(socketId: string): string | null
}

export type Request = RequestMessage & {
  requestId: string
  socketId: string
  expiration: Date
}
