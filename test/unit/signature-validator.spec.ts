import type { IFetchComponent } from '@dcl/core-commons'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { createSignatureValidatorAdapter, ISignatureValidatorAdapter } from '../../src/adapters/signature-validator'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'

const OWNER = '0x16f1d6d51c594b147ba40e3e113e9d24a24d193b'
const EPHEMERAL = '0x1234567890abcdef1234567890abcdef12345678'

const buildAuthChain = (ephemeralLinkType: AuthLinkType): AuthChain => [
  { type: AuthLinkType.SIGNER, payload: OWNER, signature: '' },
  { type: ephemeralLinkType, payload: 'Decentraland Login\nEphemeral address: ...', signature: '0xabc' }
]

let config: IConfigComponent
let fetchMock: jest.Mock
let fetch: IFetchComponent
let logs: ILoggerComponent
let logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock; info: jest.Mock; debug: jest.Mock }
let adapter: ISignatureValidatorAdapter

beforeEach(() => {
  config = {
    getString: jest.fn().mockResolvedValue(undefined),
    getNumber: jest.fn().mockResolvedValue(undefined),
    requireString: jest.fn(),
    requireNumber: jest.fn()
  } as unknown as IConfigComponent
  fetchMock = jest.fn()
  fetch = { fetch: fetchMock } as unknown as IFetchComponent
  logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
  logs = { getLogger: () => logger } as unknown as ILoggerComponent
  adapter = createSignatureValidatorAdapter({ config, fetch, logs })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('requiresOnChainValidation', () => {
  describe('when the ephemeral link was signed by an account with code behind it', () => {
    it('should report the chain cannot be settled offline', () => {
      expect(adapter.requiresOnChainValidation(buildAuthChain(AuthLinkType.ECDSA_EIP_1654_EPHEMERAL))).toBe(true)
    })
  })

  describe('when the chain carries an EIP-1654 signed entity', () => {
    it('should report the chain cannot be settled offline', () => {
      const authChain: AuthChain = [
        ...buildAuthChain(AuthLinkType.ECDSA_PERSONAL_EPHEMERAL),
        { type: AuthLinkType.ECDSA_EIP_1654_SIGNED_ENTITY, payload: 'entity', signature: '0xdef' }
      ]

      expect(adapter.requiresOnChainValidation(authChain)).toBe(true)
    })
  })

  describe('when every link was signed by a plain EOA', () => {
    it('should report the chain verifies offline, so nothing leaves the service', () => {
      expect(adapter.requiresOnChainValidation(buildAuthChain(AuthLinkType.ECDSA_PERSONAL_EPHEMERAL))).toBe(false)
    })
  })
})

describe('validateOnChain', () => {
  let authChain: AuthChain

  beforeEach(() => {
    authChain = buildAuthChain(AuthLinkType.ECDSA_EIP_1654_EPHEMERAL)
  })

  describe('when the Catalyst accepts the signature', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should report it as valid', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({ ok: true })
    })

    it('should send the ephemeral address as the signed message, which is what the Catalyst checks against', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ authChain, signedMessage: EPHEMERAL })
    })

    it('should call the Catalyst validation endpoint', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer.decentraland.org/lambdas/crypto/validate-signature')
    })

    it("should own the deadline through its own controller, rather than the fetch component's header-only timeout", async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][1].abortController).toBeInstanceOf(AbortController)
      expect(fetchMock.mock.calls[0][1].timeout).toBeUndefined()
    })

    it('should leave the request unaborted once it answers in time', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][1].abortController.signal.aborted).toBe(false)
    })
  })

  describe('when the Catalyst rejects the signature', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, error: 'Invalid signature' }) })
    })

    it('should report the reason it gave', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Invalid signature'
      })
    })
  })

  describe('when the Catalyst answers with an error status', () => {
    let cancel: jest.Mock

    beforeEach(() => {
      cancel = jest.fn().mockResolvedValue(undefined)
      fetchMock.mockResolvedValue({ ok: false, status: 503, body: { cancel }, json: async () => ({}) })
    })

    it('should fail closed, since an unverified signature is not an accepted one', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain (503)'
      })
    })

    it('should drain the body, so undici returns the socket to the pool', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('should log the status, so an upstream turning everyone away is visible', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { status: 503 })
    })
  })

  describe('and the body cannot be drained', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        body: { cancel: jest.fn().mockRejectedValue(new Error('already consumed')) },
        json: async () => ({})
      })
    })

    it('should still answer, rather than turning it into a different failure', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain (503)'
      })
    })
  })

  describe('when the Catalyst cannot be reached', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue(new Error('network down'))
    })

    it('should fail closed rather than let the signature through', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })
  })

  describe('when the Catalyst answers its headers and then stalls the body', () => {
    beforeEach(() => {
      config.getNumber = jest
        .fn()
        .mockImplementation(async (key: string) => (key === 'PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS' ? 20 : undefined))
      adapter = createSignatureValidatorAdapter({ config, fetch, logs })
      // The fetch component clears its own timer as soon as the headers arrive, so only a
      // deadline owned here can still reach a body that never comes.
      fetchMock.mockImplementation(async (_url: string, options: { abortController: AbortController }) => ({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
          })
      }))
    })

    it('should abort it and fail closed, instead of holding the login open', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })
  })

  describe('when the chain carries more links than the Catalyst accepts', () => {
    beforeEach(() => {
      authChain = [
        { type: AuthLinkType.SIGNER, payload: OWNER, signature: '' },
        ...Array.from({ length: 10 }, () => ({
          type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL,
          payload: 'Decentraland Login\nEphemeral address: ...',
          signature: '0xabc'
        }))
      ]
    })

    it('should refuse it without spending a call on a chain that would be rejected anyway', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Auth chain length must be between 1 and 10'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('when as many validations are already in flight as are allowed', () => {
    let resolveInFlight: (value: unknown) => void
    let inFlight: Promise<{ ok: boolean; message?: string }>[]

    beforeEach(async () => {
      config.getNumber = jest.fn().mockImplementation(async (key: string) => (key === 'PEER_VALIDATION_MAX_CONCURRENT' ? 2 : undefined))
      adapter = createSignatureValidatorAdapter({ config, fetch, logs })
      const held = new Promise(resolve => {
        resolveInFlight = resolve
      })
      fetchMock.mockImplementation(async () => {
        await held
        return { ok: true, status: 200, json: async () => ({ valid: true }) }
      })

      inFlight = [adapter.validateOnChain(authChain, EPHEMERAL), adapter.validateOnChain(authChain, EPHEMERAL)]
      // Let both take their slot before the third one asks for one.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    afterEach(async () => {
      resolveInFlight(undefined)
      await Promise.all(inFlight)
    })

    it('should refuse the next one rather than queue it behind a saturated upstream', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })

    it('should not let it reach the Catalyst', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should record it, so a saturated cap is visible rather than silent', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { inFlight: 2, maxConcurrent: 2 })
    })

    it('should let a later validation through once a slot is freed', async () => {
      resolveInFlight(undefined)
      await Promise.all(inFlight)

      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({ ok: true })
    })
  })

  describe('when a Catalyst is configured', () => {
    beforeEach(() => {
      config.getString = jest.fn().mockResolvedValue('https://peer-ec1.decentraland.org/')
      adapter = createSignatureValidatorAdapter({ config, fetch, logs })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true }) })
    })

    it('should use it, without doubling the slash before the path', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer-ec1.decentraland.org/lambdas/crypto/validate-signature')
    })
  })
})
