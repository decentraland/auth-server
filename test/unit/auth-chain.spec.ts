import { AuthIdentity } from '@dcl/crypto'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { ISignatureValidatorAdapter, ValidationCaller } from '../../src/adapters/signature-validator'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { createTestIdentity } from '../utils/test-identity'

const CALLER: ValidationCaller = { pool: 'anonymous', clientKeys: ['ip:203.0.113.7'] }

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
      await expect(validateAuthChain([], signatureValidator, CALLER)).rejects.toThrow('Auth chain is required')
      expect(validateOnChain).not.toHaveBeenCalled()
    })
  })

  describe('when every link was signed by a plain EOA', () => {
    it('should settle it offline, without reaching the Catalyst', async () => {
      await validateAuthChain(authChain, signatureValidator, CALLER)

      expect(validateOnChain).not.toHaveBeenCalled()
    })

    it('should return the owner and the ephemeral address', async () => {
      await expect(validateAuthChain(authChain, signatureValidator, CALLER)).resolves.toEqual({
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

    it('should hand the chain, the ephemeral address and the caller to the on-chain validator', async () => {
      await validateAuthChain(authChain, signatureValidator, CALLER)

      expect(validateOnChain).toHaveBeenCalledWith(authChain, identity.ephemeralIdentity.address, CALLER)
    })

    it('should accept it when the Catalyst does', async () => {
      await expect(validateAuthChain(authChain, signatureValidator, CALLER)).resolves.toEqual({
        sender: expect.any(String),
        finalAuthority: identity.ephemeralIdentity.address
      })
    })

    describe('and the on-chain validation turns it down', () => {
      beforeEach(() => {
        validateOnChain.mockResolvedValue({ ok: false, message: 'Could not validate the signature on chain (503)' })
      })

      it('should surface the reason it gave, rather than a generic failure', async () => {
        await expect(validateAuthChain(authChain, signatureValidator, CALLER)).rejects.toThrow(
          'Could not validate the signature on chain (503)'
        )
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
      await expect(validateAuthChain(authChain, signatureValidator, CALLER)).rejects.toThrow('Ephemeral payload has expired')
    })

    it('should not spend a Catalyst call on a chain that cannot be used anyway', async () => {
      await expect(validateAuthChain(authChain, signatureValidator, CALLER)).rejects.toThrow()

      expect(validateOnChain).not.toHaveBeenCalled()
    })
  })
})
