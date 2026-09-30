import type { IFetchComponent } from '@dcl/core-commons'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { createSignatureValidatorAdapter, ISignatureValidatorAdapter } from '../../src/adapters/signature-validator'
import type { metricDeclarations } from '../../src/metrics'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'

const OWNER = '0x16f1d6d51c594b147ba40e3e113e9d24a24d193b'
const EPHEMERAL = '0x1234567890abcdef1234567890abcdef12345678'

const buildAuthChain = (ephemeralLinkType: AuthLinkType): AuthChain => [
  { type: AuthLinkType.SIGNER, payload: OWNER, signature: '' },
  { type: ephemeralLinkType, payload: 'Decentraland Login\nEphemeral address: ...', signature: '0xabc' }
]

const givenStrings = (values: Record<string, string>) => jest.fn().mockImplementation(async (key: string) => values[key])

let config: IConfigComponent
let fetchMock: jest.Mock
let fetch: IFetchComponent
let logs: ILoggerComponent
let logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock; info: jest.Mock; debug: jest.Mock }
let increment: jest.Mock
let metrics: IMetricsComponent<keyof typeof metricDeclarations>
let adapter: ISignatureValidatorAdapter

beforeEach(async () => {
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
  increment = jest.fn()
  metrics = { increment } as unknown as IMetricsComponent<keyof typeof metricDeclarations>
  adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
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

describe('when building the adapter', () => {
  describe('and a bound is set to zero', () => {
    it('should refuse to start rather than abort every call', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '0' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS" should be a positive integer.* got "0" instead/
      )
    })

    it('should refuse to start rather than turn every login away', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '0' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_MAX_CONCURRENT" should be a positive integer.* got "0" instead/
      )
    })
  })

  describe('and a bound is not a whole number', () => {
    it('should refuse to start', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '2.5' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_MAX_CONCURRENT" should be a positive integer.* got "2\.5" instead/
      )
    })
  })

  describe('and a bound carries a unit suffix', () => {
    it('should refuse to start, rather than let parseFloat read it as a 5ms deadline', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '5s' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS" should be a positive integer.* got "5s" instead/
      )
    })
  })

  describe('and the timeout is larger than a timer can hold', () => {
    it('should refuse to start, since Node would clamp it to 1ms and abort every call', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '3000000000' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS" should be a positive integer no larger than 2147483647/
      )
    })

    it('should accept the largest delay a timer honours', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: String(2 ** 31 - 1) })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).resolves.toBeDefined()
    })
  })

  describe('and the Catalyst is reached over plain http', () => {
    it('should refuse to start, since anyone on that link could forge a valid verdict', async () => {
      config.getString = givenStrings({ PEER_URL: 'http://peer.decentraland.org' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        'Configuration: config "PEER_URL" should use https, got "http://peer.decentraland.org" instead'
      )
    })
  })

  describe('and the Catalyst is not an absolute URL', () => {
    it('should refuse to start, rather than fail on the first smart-account login', async () => {
      config.getString = givenStrings({ PEER_URL: 'peer.decentraland.org' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        'Configuration: config "PEER_URL" should be an absolute URL, got "peer.decentraland.org" instead'
      )
    })
  })

  describe('and the config is read at construction', () => {
    it('should not wait for the first login to find out the Catalyst is unset', async () => {
      config.getString = jest.fn().mockRejectedValue(new Error('Configuration: config "PEER_URL" is unreadable'))

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow('PEER_URL')
    })

    it('should record the values actually in force', async () => {
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('https://peer.decentraland.org'), {
        timeout: 5000,
        maxConcurrent: 10
      })
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

  describe('when the Catalyst answers about a different account', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ valid: true, ownerAddress: '0x0000000000000000000000000000000000000001' })
      })
    })

    it('should not let that settle this chain', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it('should meter it apart, since it points at a peer on the wrong chain rather than a bad signature', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response' })
    })
  })

  describe('when the answer does not have the shape the Catalyst promises', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: 'false', ownerAddress: OWNER }) })
    })

    it('should not read a non-boolean verdict as valid', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it('should meter it apart, so a misrouted PEER_URL does not read as a wave of bad signatures', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response' })
      expect(logger.warn).toHaveBeenCalled()
    })

    it('should not accept a verdict with no owner to check it against', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true }) })

      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
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

    it('should not count it as a refusal, since the validation worked', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).not.toHaveBeenCalled()
    })
  })

  describe('when the peer answers with a reason that is not text', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, error: { code: 500 } }) })
    })

    it('should not pass it on, since it would reach the client as [object Object]', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
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

    it('should count it apart from the local refusals', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'upstream_status' })
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

    it('should count it apart from the local refusals', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'unreachable' })
    })
  })

  describe('when the Catalyst answers its headers and then stalls the body', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '20' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
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

    it('should count it as a timeout, apart from a Catalyst that cannot be reached', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'timeout' })
    })
  })

  describe('when the Catalyst never answers its headers', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '20' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockImplementation(
        (_url: string, options: { abortController: AbortController }) =>
          new Promise((_resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => reject(new Error('Request aborted (timed out)')))
          })
      )
    })

    it('should give up at the deadline and count it as a timeout', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'timeout' })
    })
  })

  describe('when the peer answers 200 with something that is not a JSON object', () => {
    const bodies: [string, () => Promise<unknown>][] = [
      ['an HTML page', async () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))],
      ['JSON null', async () => null],
      ['a JSON array', async () => []],
      ['a bare JSON string', async () => 'ok']
    ]

    it.each(bodies)('should fail closed when it is %s', async (_body, json) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json })

      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it.each(bodies)('should count %s as a bad answer rather than an unreachable Catalyst', async (_body, json) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json })

      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response' })
      expect(increment).not.toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'unreachable' })
    })
  })

  describe('when the Catalyst rejects the signature with a very long reason', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, error: 'x'.repeat(5000) }) })
    })

    it('should cap what reaches the client', async () => {
      const result = await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(result.message).toHaveLength(200)
    })
  })

  describe('when a validation ends in a failure and the cap allows a single one', () => {
    const failures: [string, () => void][] = [
      ['the Catalyst cannot be reached', () => fetchMock.mockRejectedValueOnce(new Error('network down'))],
      [
        'the Catalyst answers an error status',
        () => fetchMock.mockResolvedValueOnce({ ok: false, status: 503, body: { cancel: async () => undefined } })
      ],
      [
        'the Catalyst validates a different account',
        () =>
          fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ valid: true, ownerAddress: '0x0000000000000000000000000000000000000001' })
          })
      ],
      [
        'the peer answers a body that is not JSON',
        () => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => null })
      ],
      [
        'the call hits the deadline',
        () =>
          fetchMock.mockImplementationOnce(
            (_url: string, options: { abortController: AbortController }) =>
              new Promise((_resolve, reject) => {
                options.abortController.signal.addEventListener('abort', () => reject(new Error('Request aborted (timed out)')))
              })
          )
      ]
    ]

    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '1', PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '20' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it.each(failures)('should free its slot when %s, so the next login still gets through', async (_failure, arrange) => {
      arrange()
      await adapter.validateOnChain(authChain, EPHEMERAL)

      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({ ok: true })
      expect(increment).not.toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached' })
    })
  })

  describe('when the chain is not shaped like a login', () => {
    const shapes: [string, AuthChain][] = [
      [
        'it carries more links than a login ever has',
        [
          { type: AuthLinkType.SIGNER, payload: OWNER, signature: '' },
          ...Array.from({ length: 3 }, () => ({
            type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL,
            payload: 'Decentraland Login\nEphemeral address: ...',
            signature: '0xabc'
          }))
        ]
      ],
      [
        'it does not start with the account that signed it',
        [
          { type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL, payload: 'Decentraland Login', signature: '0xabc' },
          { type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL, payload: 'Decentraland Login', signature: '0xabc' }
        ]
      ],
      ['its second link is not the ephemeral one', buildAuthChain(AuthLinkType.ECDSA_EIP_1654_SIGNED_ENTITY)]
    ]

    it.each(shapes)('should refuse it without spending a Catalyst call when %s', async (_shape, forged) => {
      await expect(adapter.validateOnChain(forged, EPHEMERAL)).resolves.toEqual({
        ok: false,
        message: 'Auth chain is not shaped like a login'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should count it, so forged traffic is visible on a dashboard', async () => {
      await adapter.validateOnChain(shapes[0][1], EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_shape' })
    })
  })

  describe('when as many validations are already in flight as are allowed', () => {
    let resolveInFlight: (value: unknown) => void
    let inFlight: Promise<{ ok: boolean; message?: string }>[]

    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '2' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      const held = new Promise(resolve => {
        resolveInFlight = resolve
      })
      fetchMock.mockImplementation(async () => {
        await held
        return { ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) }
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

    it('should count it, since a saturated cap turning logins away is what to alert on', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached' })
    })

    it('should let a later validation through once a slot is freed', async () => {
      resolveInFlight(undefined)
      await Promise.all(inFlight)

      await expect(adapter.validateOnChain(authChain, EPHEMERAL)).resolves.toEqual({ ok: true })
    })
  })

  describe('when the configured Catalyst carries a path', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_URL: 'https://peer-ec1.decentraland.org/content/other' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should keep only its origin, as the crypto middleware does', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer-ec1.decentraland.org/lambdas/crypto/validate-signature')
    })
  })

  describe('when a Catalyst is configured', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_URL: 'https://peer-ec1.decentraland.org/' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should use it, without doubling the slash before the path', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer-ec1.decentraland.org/lambdas/crypto/validate-signature')
    })
  })
})
