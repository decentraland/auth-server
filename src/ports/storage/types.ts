import { AuthIdentity } from '@dcl/crypto'
import { OutcomeResponseMessage, Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): StorageRequest | null
  setRequest(requestId: string, request: StorageRequest | null): void
  getRequestIdForSocketId(socketId: string): string | null
  getIdentityId(identityId: string): StorageIdentityId | null
  setIdentityId(identityId: string, identityData: StorageIdentityId | null): void
  deleteIdentityId(identityId: string): void
  deleteExpiredIdentityId(): void
}

export type StorageRequest = Request & {
  requestId: string
  socketId?: string
  expiration: Date
  code: number
  sender?: string
  response?: OutcomeResponseMessage
  requiresValidation: boolean
}

export type StorageIdentityId = {
  identityId: string
  identity: AuthIdentity
  expiration: Date
  createdAt: Date
}
