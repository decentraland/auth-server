import { AuthIdentity } from '@dcl/crypto'
import { OutcomeResponseMessage, Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): StorageRequest | null
  setRequest(requestId: string, request: StorageRequest | null): void
  getRequestIdForSocketId(socketId: string): string | null
  getIdentity(identityId: string): StorageIdentity | null
  setIdentity(identityId: string, identityData: StorageIdentity | null): void
  deleteIdentity(identityId: string): void
}

export type StorageRequest = Request & {
  requestId: string
  socketId?: string
  expiration: Date
  code: number
  sender?: string
  response?: OutcomeResponseMessage
  requiresValidation: boolean
  // IP validation field
  originalIp: string
}

export type StorageIdentity = {
  identityId: string
  identity: AuthIdentity
  expiration: Date
  createdAt: Date
}
