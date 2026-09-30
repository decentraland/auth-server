import { AuthIdentity } from '@dcl/crypto'
import { validateAuthChainSignature } from '@dcl/crypto-middleware'
import { AuthChain } from '@dcl/schemas'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { asContractAccountChain, contractAccountThat } from '../utils/l1-provider'
import { createTestIdentity } from '../utils/test-identity'
import type { IL1Provider } from '../../src/adapters/l1-provider'

describe('validateAuthChain', () => {
  let identity: AuthIdentity
  let sendAsync: jest.Mock
  let l1Provider: IL1Provider

  beforeEach(async () => {
    identity = await createTestIdentity()
    sendAsync = jest.fn((_payload, callback) => callback(new Error('No RPC in tests')))
    l1Provider = { sendAsync }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

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

      it('should validate it on chain and release its validation signal', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).resolves.toEqual({
          sender: identity.authChain[0].payload,
          finalAuthority: identity.ephemeralIdentity.address
        })
        expect(sendAsync).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_call' }),
          expect.any(Function),
          expect.objectContaining({ aborted: true })
        )
      })
    })

    describe('and the account rejects the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('rejects'))
      })

      it('should reject the chain, since the account did not confirm it', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow(/Invalid validation/)
        expect(sendAsync).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_call' }),
          expect.any(Function),
          expect.any(AbortSignal)
        )
      })
    })

    describe('and the provider never answers', () => {
      let outcome: Promise<void>

      beforeEach(() => {
        jest.useFakeTimers()
        sendAsync.mockImplementation(() => undefined)
        outcome = expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow('Signature validation timed out')
      })

      it('should abort the RPC signal and reject the chain after the deadline', async () => {
        await jest.advanceTimersByTimeAsync(15_000)
        await outcome

        expect(sendAsync).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'eth_call' }),
          expect.any(Function),
          expect.objectContaining({ aborted: true })
        )
      })
    })

    describe('and a successful RPC response arrives after the deadline', () => {
      let outcome: Promise<void>

      beforeEach(() => {
        jest.useFakeTimers()
        authChain.push({ ...authChain[1] })
        sendAsync.mockImplementation((payload, callback) => {
          setTimeout(() => contractAccountThat('accepts')(payload, callback), 16_000)
        })
        outcome = expect(validateAuthChainSignature(authChain, identity.ephemeralIdentity.address, l1Provider)).rejects.toThrow(
          'Signature validation timed out'
        )
      })

      it('should prevent subsequent chain links from issuing RPC requests', async () => {
        await jest.advanceTimersByTimeAsync(15_000)
        await outcome
        await jest.advanceTimersByTimeAsync(10_000)

        expect(sendAsync).toHaveBeenCalledTimes(1)
      })
    })

    describe('and another validation starts before the first validation times out', () => {
      let firstOutcome: Promise<void>
      let secondOutcome: Promise<void>

      beforeEach(async () => {
        jest.useFakeTimers()
        sendAsync
          .mockImplementationOnce(() => undefined)
          .mockImplementationOnce((payload, callback) => {
            setTimeout(() => contractAccountThat('accepts')(payload, callback), 10_000)
          })
        firstOutcome = expect(validateAuthChainSignature(authChain, identity.ephemeralIdentity.address, l1Provider)).rejects.toThrow(
          'Signature validation timed out'
        )
        await jest.advanceTimersByTimeAsync(10_000)
        secondOutcome = expect(
          validateAuthChainSignature(authChain, identity.ephemeralIdentity.address, l1Provider)
        ).resolves.toBeUndefined()
      })

      it('should keep the second validation active after aborting the first validation', async () => {
        await jest.advanceTimersByTimeAsync(5_000)
        await firstOutcome
        expect(sendAsync.mock.calls[0][2].aborted).toBe(true)
        expect(sendAsync.mock.calls[1][2].aborted).toBe(false)

        await jest.advanceTimersByTimeAsync(5_000)
        await secondOutcome
      })
    })

    describe('and the chain has exactly the maximum number of links', () => {
      beforeEach(() => {
        authChain = [authChain[0], ...Array.from({ length: 9 }, () => ({ ...authChain[1] }))]
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should validate every contract signature', async () => {
        await expect(validateAuthChainSignature(authChain, identity.ephemeralIdentity.address, l1Provider)).resolves.toBeUndefined()
        expect(sendAsync).toHaveBeenCalledTimes(9)
      })
    })

    describe('and the chain exceeds the link limit', () => {
      beforeEach(() => {
        authChain = [authChain[0], ...Array.from({ length: 10 }, () => ({ ...authChain[1] }))]
      })

      it('should reject the chain without issuing any RPC requests', async () => {
        await expect(validateAuthChainSignature(authChain, identity.ephemeralIdentity.address, l1Provider)).rejects.toThrow(
          'Auth chain exceeds maximum length of 10'
        )
        expect(sendAsync).not.toHaveBeenCalled()
      })
    })

    describe('and the provider cannot be reached', () => {
      it('should reject the chain rather than let it through', async () => {
        await expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow(/No RPC in tests/)
      })
    })
  })

  describe('when the chain is empty', () => {
    let authChain: AuthChain

    beforeEach(() => {
      authChain = []
    })

    it('should reject it', async () => {
      await expect(validateAuthChain(authChain, l1Provider)).rejects.toThrow('Auth chain is required')
    })
  })
})
