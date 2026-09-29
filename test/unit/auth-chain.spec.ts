import { AuthIdentity } from '@dcl/crypto'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { ISignatureValidatorAdapter } from '../../src/adapters/signature-validator'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { createTestIdentity } from '../utils/test-identity'

let identity: AuthIdentity
let authChain: AuthChain
let signatureValidator: ISignatureValidatorAdapter
let requiresOnChainValidation: jest.Mock
let validateOnChain: jest.Mock

beforeEach(async () => {
  identity = await createTestIdentity()
  authChain = identity.authChain
  requiresOnChainValidation = jest.fn().mockReturnValue(false)
  validateOnChain = jest.fn().mockResolvedValue({ ok: true })
  signatureValidator = { requiresOnChainValidation, validateOnChain } as unknown as ISignatureValidatorAdapter
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('validateAuthChain', () => {
  describe('when the chain is empty', () => {
    it('should reject it before anything else', async () => {
      await expect(validateAuthChain([], signatureValidator)).rejects.toThrow('Auth chain is required')
      expect(validateOnChain).not.toHaveBeenCalled()
    })
  })

  describe('when every link was signed by a plain EOA', () => {
    it('should settle it offline, without reaching the Catalyst', async () => {
      await validateAuthChain(authChain, signatureValidator)

      expect(validateOnChain).not.toHaveBeenCalled()
    })

    it('should return the owner and the ephemeral address', async () => {
      await expect(validateAuthChain(authChain, signatureValidator)).resolves.toEqual({
        sender: expect.any(String),
        finalAuthority: identity.ephemeralIdentity.address
      })
    })
  })

  describe('when a link was signed by an account with code behind it', () => {
    beforeEach(() => {
      requiresOnChainValidation.mockReturnValue(true)
      authChain = [...authChain.slice(0, -1), { ...authChain[authChain.length - 1], type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL }]
    })

    it('should hand the chain and the ephemeral address to the on-chain validator', async () => {
      await validateAuthChain(authChain, signatureValidator)

      expect(validateOnChain).toHaveBeenCalledWith(authChain, identity.ephemeralIdentity.address)
    })

    it('should accept it when the Catalyst does', async () => {
      await expect(validateAuthChain(authChain, signatureValidator)).resolves.toEqual({
        sender: expect.any(String),
        finalAuthority: identity.ephemeralIdentity.address
      })
    })

    describe('and the on-chain validation turns it down', () => {
      beforeEach(() => {
        validateOnChain.mockResolvedValue({ ok: false, message: 'Could not validate the signature on chain (503)' })
      })

      it('should surface the reason it gave, rather than a generic failure', async () => {
        await expect(validateAuthChain(authChain, signatureValidator)).rejects.toThrow('Could not validate the signature on chain (503)')
      })
    })
  })

  describe('when the ephemeral payload has expired', () => {
    beforeEach(async () => {
      requiresOnChainValidation.mockReturnValue(true)
      identity = await createTestIdentity(-1)
      authChain = identity.authChain
    })

    it('should re-throw the expiry verbatim, so callers can map it to the upstream status', async () => {
      await expect(validateAuthChain(authChain, signatureValidator)).rejects.toThrow('Ephemeral payload has expired')
    })

    it('should not spend a Catalyst call on a chain that cannot be used anyway', async () => {
      await expect(validateAuthChain(authChain, signatureValidator)).rejects.toThrow()

      expect(validateOnChain).not.toHaveBeenCalled()
    })
  })
})
