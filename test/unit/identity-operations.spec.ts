import { AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { createIdentityOperationsComponent } from '../../src/logic/identity-operations'
import { AppComponents, IIdentityOperationsComponent } from '../../src/types/components'
import { createTestIdentity } from '../utils/test-identity'

describe('when executing identity operation helpers', () => {
  let identityOperations: IIdentityOperationsComponent

  beforeEach(async () => {
    const logs = {
      getLogger: jest.fn(() => ({
        log: jest.fn(),
        error: jest.fn()
      }))
    } as unknown as AppComponents['logs']
    identityOperations = await createIdentityOperationsComponent({ logs })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  describe('and asserting ephemeral address against final authority', () => {
    describe('when both addresses match ignoring case', () => {
      let identity: AuthIdentity
      let finalAuthority: string

      beforeEach(async () => {
        identity = await createTestIdentity()
        finalAuthority = identity.ephemeralIdentity.address.toUpperCase()
      })

      it('should not throw an error', () => {
        expect(() => identityOperations.assertEphemeralAddressMatchesFinalAuthority(identity, finalAuthority)).not.toThrow()
      })
    })

    describe('when addresses do not match', () => {
      let identity: AuthIdentity
      let finalAuthority: string

      beforeEach(async () => {
        identity = await createTestIdentity()
        finalAuthority = createUnsafeIdentity().address
      })

      it('should throw an address mismatch error', () => {
        expect(() => identityOperations.assertEphemeralAddressMatchesFinalAuthority(identity, finalAuthority)).toThrow(
          'Ephemeral wallet address does not match auth chain final authority'
        )
      })
    })
  })

  describe('and asserting request sender against identity owner', () => {
    describe('when sender matches owner ignoring case', () => {
      let requestSender: string | undefined
      let identitySender: string

      beforeEach(() => {
        requestSender = '0xabc'
        identitySender = '0xABC'
      })

      it('should not throw an error', () => {
        expect(() => identityOperations.assertRequestSenderMatchesIdentityOwner(requestSender, identitySender)).not.toThrow()
      })
    })

    describe('when request sender is missing', () => {
      let requestSender: string | undefined
      let identitySender: string

      beforeEach(() => {
        requestSender = undefined
        identitySender = '0xabc'
      })

      it('should throw a sender mismatch error', () => {
        expect(() => identityOperations.assertRequestSenderMatchesIdentityOwner(requestSender, identitySender)).toThrow(
          'Request sender does not match identity owner'
        )
      })
    })

    describe('when sender does not match owner', () => {
      let requestSender: string | undefined
      let identitySender: string

      beforeEach(() => {
        requestSender = '0xabc'
        identitySender = '0xdef'
      })

      it('should throw a sender mismatch error', () => {
        expect(() => identityOperations.assertRequestSenderMatchesIdentityOwner(requestSender, identitySender)).toThrow(
          'Request sender does not match identity owner'
        )
      })
    })
  })

  describe('and asserting ephemeral private key against its address', () => {
    describe('when identity is valid', () => {
      let identity: AuthIdentity

      beforeEach(async () => {
        identity = await createTestIdentity()
      })

      it('should not throw an error', () => {
        expect(() => identityOperations.assertEphemeralPrivateKeyMatchesAddress(identity)).not.toThrow()
      })
    })

    describe('when private key does not match the ephemeral address', () => {
      let identityWithInvalidPrivateKey: AuthIdentity

      beforeEach(async () => {
        const identity = await createTestIdentity()
        const differentWallet = createUnsafeIdentity()

        identityWithInvalidPrivateKey = {
          ...identity,
          ephemeralIdentity: {
            ...identity.ephemeralIdentity,
            privateKey: differentWallet.privateKey
          }
        }
      })

      it('should throw a private key mismatch error', () => {
        expect(() => identityOperations.assertEphemeralPrivateKeyMatchesAddress(identityWithInvalidPrivateKey)).toThrow(
          'Ephemeral private key does not match the provided address'
        )
      })
    })
  })

  describe('and building a storage identity', () => {
    let identity: AuthIdentity
    let now: Date
    let storageIdentity: ReturnType<IIdentityOperationsComponent['buildStorageIdentity']>

    beforeEach(async () => {
      identity = await createTestIdentity()
      now = new Date('2026-01-01T00:00:00.000Z')

      storageIdentity = identityOperations.buildStorageIdentity({
        identityId: 'iid-1',
        identity,
        clientIp: '127.0.0.1',
        isMobile: true,
        now
      })
    })

    it('should set the identity id', () => {
      expect(storageIdentity.identityId).toBe('iid-1')
    })

    it('should persist the original identity object', () => {
      expect(storageIdentity.identity).toBe(identity)
    })

    it('should set createdAt to the provided current date', () => {
      expect(storageIdentity.createdAt).toEqual(now)
    })

    it('should set expiration to fifteen minutes after createdAt', () => {
      expect(storageIdentity.expiration.getTime()).toBe(now.getTime() + 15 * 60 * 1000)
    })

    it('should persist the client ip address', () => {
      expect(storageIdentity.ipAddress).toBe('127.0.0.1')
    })

    it('should persist the mobile flag', () => {
      expect(storageIdentity.isMobile).toBe(true)
    })
  })

  describe('and checking if an identity is expired', () => {
    describe('when expiration is in the past', () => {
      let identity: { expiration: Date }
      let now: Date
      let expired: boolean

      beforeEach(() => {
        identity = { expiration: new Date(10) }
        now = new Date(11)
        expired = identityOperations.isIdentityExpired(identity, now)
      })

      it('should return true', () => {
        expect(expired).toBe(true)
      })
    })

    describe('when expiration equals the current date', () => {
      let identity: { expiration: Date }
      let now: Date
      let expired: boolean

      beforeEach(() => {
        identity = { expiration: new Date(10) }
        now = new Date(10)
        expired = identityOperations.isIdentityExpired(identity, now)
      })

      it('should return false', () => {
        expect(expired).toBe(false)
      })
    })

    describe('when expiration is in the future', () => {
      let identity: { expiration: Date }
      let now: Date
      let expired: boolean

      beforeEach(() => {
        identity = { expiration: new Date(10) }
        now = new Date(9)
        expired = identityOperations.isIdentityExpired(identity, now)
      })

      it('should return false', () => {
        expect(expired).toBe(false)
      })
    })
  })

  describe('and validating identity ip access', () => {
    describe('when identity is non-mobile and ips match', () => {
      let result: ReturnType<IIdentityOperationsComponent['validateIdentityIpAccess']>

      beforeEach(() => {
        result = identityOperations.validateIdentityIpAccess({
          identity: { ipAddress: '1.1.1.1', isMobile: false },
          clientIp: '1.1.1.1',
          ipsMatchFn: (a: string, b: string) => a === b
        })
      })

      it('should allow access without mobile mismatch', () => {
        expect(result).toEqual({ ok: true, mobileMismatch: false })
      })
    })

    describe('when identity is non-mobile and ips do not match', () => {
      let result: ReturnType<IIdentityOperationsComponent['validateIdentityIpAccess']>

      beforeEach(() => {
        result = identityOperations.validateIdentityIpAccess({
          identity: { ipAddress: '1.1.1.1', isMobile: false },
          clientIp: '2.2.2.2',
          ipsMatchFn: (a: string, b: string) => a === b
        })
      })

      it('should reject access with an ip mismatch error', () => {
        expect(result).toEqual({ ok: false, error: 'IP address mismatch' })
      })
    })

    describe('when identity is mobile and ips do not match', () => {
      let result: ReturnType<IIdentityOperationsComponent['validateIdentityIpAccess']>

      beforeEach(() => {
        result = identityOperations.validateIdentityIpAccess({
          identity: { ipAddress: '1.1.1.1', isMobile: true },
          clientIp: '2.2.2.2',
          ipsMatchFn: (a: string, b: string) => a === b
        })
      })

      it('should allow access and mark mobile mismatch', () => {
        expect(result).toEqual({ ok: true, mobileMismatch: true })
      })
    })
  })
})
