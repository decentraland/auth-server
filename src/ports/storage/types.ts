import { AuthIdentity } from '@dcl/crypto'
import { OutcomeResponseMessage, Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): Promise<StorageRequest | null>
  setRequest(requestId: string, request: StorageRequest | null): void
  getRequestIdForSocketId(socketId: string): Promise<string | null>
  getIdentity(identityId: string): Promise<StorageIdentity | null>
  setIdentity(identityId: string, identityData: StorageIdentity | null): Promise<void>
  deleteIdentity(identityId: string): Promise<void>
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

export type StorageIdentity = {
  identityId: string
  identity: AuthIdentity
  expiration: Date
  createdAt: Date
  ipAddress: string
}
