import { AuthIdentity } from '@dcl/crypto'
import { OutcomeResponseMessage, Request } from '../server/types'

export type IStorageComponent = {
  getRequest(requestId: string): Promise<StorageRequest | null>
  setRequest(requestId: string, request: StorageRequest | null): Promise<void>
  getRequestIdForSocketId(socketId: string): Promise<string | null>
  getIdentity(identityId: string): Promise<StorageIdentity | null>
  setIdentity(identityId: string, identityData: StorageIdentity | null): Promise<void>
  deleteIdentity(identityId: string): Promise<void>
  /**
   * Atomically removes and returns an identity. Concurrent callers for the same id are serialized,
   * so at most one can receive the stored private key.
   * @param identityId Identity capability to consume.
   * @returns The stored identity for the winning caller, or null once it has been consumed.
   */
  takeIdentity(identityId: string): Promise<StorageIdentity | null>
  getIdentityStatus(identityId: string): Promise<IdentityStatus | null>
  setIdentityStatus(identityId: string, status: IdentityStatus): Promise<void>
  updateIdentityStatus(identityId: string, updates: Partial<IdentityStatus>): Promise<void>
  /**
   * Marks a Magic DID token id (`tid`) as used. Returns `true` if it was not
   * seen before (and is now recorded for `ttlSeconds`), `false` if it was
   * already used — enabling one-time-use enforcement to prevent replay.
   */
  consumeDidTokenId(tid: string, ttlSeconds: number): Promise<boolean>
}

export type StorageRequest = Request & {
  requestId: string
  socketId?: string
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

export type IdentityStatus = {
  expiration: Date
  createdAt: Date
  consumed: boolean
  signer: string
  deletionReason?: 'consumed' | 'expired' | 'ip_mismatch'
}
