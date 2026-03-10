import { AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { AuthChain } from '@dcl/schemas'
import { createAuthChainComponent } from '../../src/logic/auth-chain'
import { AppComponents, IAuthChainComponent } from '../../src/types/components'
import { createTestIdentity } from '../utils/test-identity'

describe('when validating an auth chain', () => {
  let authChainComponent: IAuthChainComponent

  beforeEach(async () => {
    const logs = {
      getLogger: jest.fn(() => ({
        log: jest.fn(),
        error: jest.fn()
      }))
    } as unknown as AppComponents['logs']
    authChainComponent = await createAuthChainComponent({ logs })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  describe('and the auth chain is valid', () => {
    let identity: AuthIdentity
    let sender: string
    let finalAuthority: string

    beforeEach(async () => {
      identity = await createTestIdentity()
      const result = await authChainComponent.validateAuthChain(identity.authChain)
      sender = result.sender
      finalAuthority = result.finalAuthority
    })

    it('should return the sender from the auth chain owner', () => {
      expect(sender.toLowerCase()).toBe(identity.authChain[0].payload.toLowerCase())
    })

    it('should return the final authority from the ephemeral identity address', () => {
      expect(finalAuthority.toLowerCase()).toBe(identity.ephemeralIdentity.address.toLowerCase())
    })
  })

  describe('and the auth chain is empty', () => {
    let authChain: AuthChain

    beforeEach(() => {
      authChain = []
    })

    it('should throw an auth chain required error', async () => {
      await expect(authChainComponent.validateAuthChain(authChain)).rejects.toThrow('Auth chain is required')
    })
  })

  describe('and the final authority payload cannot be parsed', () => {
    let identity: AuthIdentity
    let invalidAuthChain: AuthChain

    beforeEach(async () => {
      identity = await createTestIdentity()
      invalidAuthChain = [...identity.authChain]
      invalidAuthChain[invalidAuthChain.length - 1] = {
        ...invalidAuthChain[invalidAuthChain.length - 1],
        payload: 'unparsable'
      }
    })

    it('should throw a final authority parsing error', async () => {
      await expect(authChainComponent.validateAuthChain(invalidAuthChain)).rejects.toThrow('Could not get final authority from auth chain')
    })
  })

  describe('and signature validation fails', () => {
    let identity: AuthIdentity
    let invalidAuthChain: AuthChain

    beforeEach(async () => {
      const otherAccount = createUnsafeIdentity()

      identity = await createTestIdentity()
      invalidAuthChain = [...identity.authChain]
      invalidAuthChain[0] = {
        ...invalidAuthChain[0],
        payload: otherAccount.address
      }
    })

    it('should throw the signer validation error', async () => {
      await expect(authChainComponent.validateAuthChain(invalidAuthChain)).rejects.toThrow('Invalid signer address')
    })
  })

  describe('and the ephemeral payload is expired', () => {
    let expiredIdentity: AuthIdentity

    beforeEach(async () => {
      expiredIdentity = await createTestIdentity(-1)
    })

    it('should propagate the ephemeral expiration error', async () => {
      await expect(authChainComponent.validateAuthChain(expiredIdentity.authChain)).rejects.toThrow('Ephemeral key has expired')
    })
  })
})
