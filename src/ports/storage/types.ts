import { IBaseComponent } from '@well-known-components/interfaces'
import { Request } from '../server/types'

export type IStorageComponent = IBaseComponent & {
  getRequest(requestId: string): StorageRequest | null
  setRequest(requestId: string, request: StorageRequest | null): void
  getRequestIdForSocketId(socketId: string): string | null
}

export type StorageRequest = Request & {
  requestId: string
  socketId: string
  expiration: Date
  code: number
  sender?: string
}
