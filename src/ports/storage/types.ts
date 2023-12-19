import { RequestMessage } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): Request | null
  setRequest(requestId: string, request: Request): void
}

export type Request = RequestMessage & {
  requestId: string
  socketId: string
}
