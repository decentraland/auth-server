import { AuthIdentity } from '@dcl/crypto'
import { OutcomeResponseMessage, Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): Promise<StorageRequest | null>
  setRequest(requestId: string, request: StorageRequest): Promise<void>
  deleteRequest(requestId: string): Promise<void>
  getIdentity(identityId: string): Promise<StorageIdentity | null>
  setIdentity(identityId: string, identityData: StorageIdentity | null): Promise<void>
  deleteIdentity(identityId: string): Promise<void>
}

export type StorageRequest = Request & {
  requestId: string
  expiration: Date
  code: number
  sender?: string
  response?: OutcomeResponseMessage
  requiresValidation: boolean
  fulfilled?: boolean
}

export type StorageIdentity = {
  identityId: string
  identity: AuthIdentity
  expiration: Date
  createdAt: Date
  ipAddress: string
  isMobile?: boolean
}
