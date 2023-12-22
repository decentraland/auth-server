import { Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): StorageRequest | null
  setRequest(requestId: string, request: StorageRequest | null): void
  getRequestIdForSocketId(socketId: string): string | null
}

export type StorageRequest = Request & {
  requestId: string
  socketId: string
  expiration: Date
  code: number
}
