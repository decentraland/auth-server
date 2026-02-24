import type { AuthIdentity } from '@dcl/crypto'
import type { StorageIdentity } from '../ports/storage/types'

export type BuildStorageIdentityParams = {
  identityId: string
  identity: AuthIdentity
  clientIp: string
  isMobile?: boolean
  now?: Date
}

export type ValidateIdentityIpAccessParams = {
  identity: Pick<StorageIdentity, 'ipAddress' | 'isMobile'>
  clientIp: string
  ipsMatchFn: (a: string, b: string) => boolean
}

export type ValidateIdentityIpAccessResult = { ok: true; mobileMismatch: boolean } | { ok: false; error: 'IP address mismatch' }
