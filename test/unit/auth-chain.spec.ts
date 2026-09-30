import { AuthIdentity } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { asContractAccountChain, contractAccountThat } from '../utils/l1-provider'
import { createTestIdentity } from '../utils/test-identity'
import type { IL1Provider } from '../../src/adapters/l1-provider'

let identity: AuthIdentity
let sendAsync: jest.Mock
let l1Provider: IL1Provider

beforeEach(async () => {
  identity = await createTestIdentity()
  sendAsync = jest.fn((_payload, callback) => callback(new Error('No RPC in tests')))
  l1Provider = { sendAsync } as unknown as IL1Provider
})

describe('validateAuthChain', () => {
  describe('when every link was signed by a plain EOA', () => {
    it('should validate it offline, without calling the provider', async () => {
      await expect(validateAuthChain(identity.authChain, l1Provider)).resolves.toEqual({
        sender: identity.authChain[0].payload,
        finalAuthority: identity.ephemeralIdentity.address
      })
      expect(sendAsync).not.toHaveBeenCalled()
    })
  })

  describe('when the chain was signed by an account with code behind it', () => {
    let authChain: AuthChain

    beforeEach(() => {
      authChain = asContractAccountChain(identity.authChain)
    })

    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should validate it on chain', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).resolves.toEqual({
          sender: identity.authChain[0].payload,
          finalAuthority: identity.ephemeralIdentity.address
        })
        expect(sendAsync).toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_call' }), expect.any(Function))
      })
    })

    describe('and the account rejects the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('rejects'))
      })

      it('should reject the chain, since the account did not confirm it', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow(/Invalid validation/)
        expect(sendAsync).toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_call' }), expect.any(Function))
      })
    })

    describe('and the provider never answers', () => {
      beforeEach(() => {
        jest.useFakeTimers()
        sendAsync.mockImplementation(() => undefined)
      })

      afterEach(() => {
        jest.useRealTimers()
      })

      it('should give up after the validation deadline and reject the chain', async () => {
        const validation = validateAuthChain(authChain, l1Provider)
        const outcome = expect(validation).rejects.toThrow('Signature validation timed out')

        await jest.advanceTimersByTimeAsync(15_000)

        await outcome
      })
    })

    describe('and the provider cannot be reached', () => {
      it('should reject the chain rather than let it through', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow(/No RPC in tests/)
      })
    })
  })

  describe('when the chain is empty', () => {
    it('should reject it', async () => {
      await expect(validateAuthChain([], l1Provider)).rejects.toThrow('Auth chain is required')
    })
  })
})
