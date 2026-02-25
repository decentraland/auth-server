import { ethers } from 'ethers'
import type { AuthIdentity } from '@dcl/crypto'
import { FIFTEEN_MINUTES_IN_MILLISECONDS } from '../ports/server/constants'
import type { StorageIdentity } from '../ports/storage/types'
import type { AppComponents, IIdentityOperationsComponent } from '../types/components'
import { EphemeralAddressMismatchError, EphemeralPrivateKeyMismatchError, RequestSenderMismatchError } from './errors'
import type {
  BuildStorageIdentityParams,
  ValidateIdentityIpAccessParams,
  ValidateIdentityIpAccessResult
} from './identity-operations.types'

export async function createIdentityOperationsComponent({ logs }: Pick<AppComponents, 'logs'>): Promise<IIdentityOperationsComponent> {
  const logger = logs.getLogger('identity-operations-component')

  const assertEphemeralAddressMatchesFinalAuthority = (identity: AuthIdentity, finalAuthority: string): void => {
    if (identity.ephemeralIdentity.address.toLowerCase() !== finalAuthority.toLowerCase()) {
      logger.log('Ephemeral wallet address does not match auth chain final authority')
      throw new EphemeralAddressMismatchError(identity.ephemeralIdentity.address, finalAuthority)
    }
  }

  const assertRequestSenderMatchesIdentityOwner = (requestSender: string | undefined, identitySender: string): void => {
    if (!requestSender || requestSender.toLowerCase() !== identitySender.toLowerCase()) {
      logger.log('Request sender does not match identity owner')
      throw new RequestSenderMismatchError(requestSender, identitySender)
    }
  }

  const assertEphemeralPrivateKeyMatchesAddress = (identity: AuthIdentity): void => {
    const wallet = new ethers.Wallet(identity.ephemeralIdentity.privateKey)

    if (wallet.address.toLowerCase() !== identity.ephemeralIdentity.address.toLowerCase()) {
      logger.log('Ephemeral private key does not match the provided address')
      throw new EphemeralPrivateKeyMismatchError(identity.ephemeralIdentity.address)
    }
  }

  const buildStorageIdentity = (params: BuildStorageIdentityParams): StorageIdentity => {
    const createdAt = params.now ?? new Date()
    const expiration = new Date(createdAt.getTime() + FIFTEEN_MINUTES_IN_MILLISECONDS)

    return {
      identityId: params.identityId,
      identity: params.identity,
      expiration,
      createdAt,
      ipAddress: params.clientIp,
      isMobile: params.isMobile === true
    }
  }

  const isIdentityExpired = (identity: Pick<StorageIdentity, 'expiration'>, now: Date = new Date()): boolean => {
    return identity.expiration < now
  }

  const validateIdentityIpAccess = (params: ValidateIdentityIpAccessParams): ValidateIdentityIpAccessResult => {
    const matches = params.ipsMatchFn(params.identity.ipAddress, params.clientIp)

    if (params.identity.isMobile) {
      return { ok: true, mobileMismatch: !matches }
    }

    if (!matches) {
      logger.log('Identity IP address mismatch')
      return { ok: false, error: 'IP address mismatch' }
    }

    return { ok: true, mobileMismatch: false }
  }

  return {
    assertEphemeralAddressMatchesFinalAuthority,
    assertRequestSenderMatchesIdentityOwner,
    assertEphemeralPrivateKeyMatchesAddress,
    buildStorageIdentity,
    isIdentityExpired,
    validateIdentityIpAccess
  }
}
