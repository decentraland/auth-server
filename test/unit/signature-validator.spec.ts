import type { IFetchComponent } from '@dcl/core-commons'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { createSignatureValidatorAdapter, ISignatureValidatorAdapter, ValidationCaller } from '../../src/adapters/signature-validator'
import type { metricDeclarations } from '../../src/metrics'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'

const OWNER = '0x16f1d6d51c594b147ba40e3e113e9d24a24d193b'
const EPHEMERAL = '0x1234567890abcdef1234567890abcdef12345678'
const ANONYMOUS: ValidationCaller = { pool: 'anonymous', clientKeys: ['203.0.113.7'] }

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

  describe('and one client may hold more slots than the whole pool', () => {
    it('should refuse to start, since that limit could never apply', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '4', PEER_VALIDATION_MAX_CONCURRENT_PER_CLIENT: '5' })

      await expect(createSignatureValidatorAdapter({ config, fetch, logs, metrics })).rejects.toThrow(
        /"PEER_VALIDATION_MAX_CONCURRENT_PER_CLIENT" should be a positive integer no larger than 4/
      )
    })
  })

  describe('and only the pool is lowered below the default per-client share', () => {
    it('should clamp the per-client default to the pool, so the limit still applies', async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '2' })
      await createSignatureValidatorAdapter({ config, fetch, logs, metrics })

      expect(logger.log).toHaveBeenLastCalledWith(expect.any(String), { timeout: 5000, maxConcurrent: 2, maxConcurrentPerClient: 2 })
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
        maxConcurrent: 10,
        maxConcurrentPerClient: 3
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
    })

    it('should send the ephemeral address as the signed message, which is what the Catalyst checks against', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ authChain, signedMessage: EPHEMERAL })
    })

    it('should call the Catalyst validation endpoint', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer.decentraland.org/lambdas/crypto/validate-signature')
    })

    it("should own the deadline through its own controller, rather than the fetch component's header-only timeout", async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(fetchMock.mock.calls[0][1].abortController).toBeInstanceOf(AbortController)
      expect(fetchMock.mock.calls[0][1].timeout).toBeUndefined()
    })

    it('should leave the request unaborted once it answers in time', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it('should meter it apart, since it points at a peer on the wrong chain rather than a bad signature', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response', pool: 'anonymous' })
    })
  })

  describe('when the answer does not have the shape the Catalyst promises', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: 'false', ownerAddress: OWNER }) })
    })

    it('should not read a non-boolean verdict as valid', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it('should meter it apart, so a misrouted PEER_URL does not read as a wave of bad signatures', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response', pool: 'anonymous' })
      expect(logger.warn).toHaveBeenCalled()
    })

    it('should not accept a verdict with no owner to check it against', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true }) })

      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Invalid signature'
      })
    })

    it('should not count it as a refusal, since the validation worked', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).not.toHaveBeenCalled()
    })
  })

  describe('when the peer answers with a reason that is not text', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, error: { code: 500 } }) })
    })

    it('should not pass it on, since it would reach the client as [object Object]', async () => {
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain (503)'
      })
    })

    it('should drain the body, so undici returns the socket to the pool', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('should log the status, so an upstream turning everyone away is visible', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { status: 503 })
    })

    it('should count it apart from the local refusals', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'upstream_status', pool: 'anonymous' })
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })

    it('should count it apart from the local refusals', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'unreachable', pool: 'anonymous' })
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })

    it('should count it as a timeout, apart from a Catalyst that cannot be reached', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'timeout', pool: 'anonymous' })
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'timeout', pool: 'anonymous' })
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

      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Signature validation failed'
      })
    })

    it.each(bodies)('should count %s as a bad answer rather than an unreachable Catalyst', async (_body, json) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json })

      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_response', pool: 'anonymous' })
      expect(increment).not.toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'unreachable', pool: 'anonymous' })
    })
  })

  describe('when the Catalyst rejects the signature with a very long reason', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: false, error: 'x'.repeat(5000) }) })
    })

    it('should cap what reaches the client', async () => {
      const result = await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

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
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
      expect(increment).not.toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached', pool: 'anonymous' })
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
      await expect(adapter.validateOnChain(forged, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Auth chain is not shaped like a login'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should count it, so forged traffic is visible on a dashboard', async () => {
      await adapter.validateOnChain(shapes[0][1], EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'invalid_shape', pool: 'anonymous' })
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

      inFlight = [adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS), adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)]
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
      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
        ok: false,
        message: 'Could not validate the signature on chain'
      })
    })

    it('should not let it reach the Catalyst', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should record it, so a saturated cap is visible rather than silent', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { pool: 'anonymous', inFlight: 2, maxConcurrent: 2 })
    })

    it('should count it, since a saturated cap turning logins away is what to alert on', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached', pool: 'anonymous' })
    })

    it('should log a flood of refusals once rather than once per request, while still counting each', async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)
      }

      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(increment).toHaveBeenCalledTimes(5)
    })

    it('should let a later validation through once a slot is freed', async () => {
      resolveInFlight(undefined)
      await Promise.all(inFlight)

      await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
    })
  })

  describe('when the configured Catalyst carries a path', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_URL: 'https://peer-ec1.decentraland.org/content/other' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should keep only its origin, as the crypto middleware does', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer-ec1.decentraland.org/lambdas/crypto/validate-signature')
    })
  })

  describe('when validations are held open', () => {
    let release: (value: unknown) => void
    let held: Promise<{ ok: boolean; message?: string }>[]

    const holdCatalyst = () => {
      const gate = new Promise(resolve => {
        release = resolve
      })
      fetchMock.mockImplementation(async () => {
        await gate
        return { ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) }
      })
    }

    const settle = async () => {
      // Let every started call take its slot before the next one asks for one.
      for (let i = 0; i < 5; i++) await Promise.resolve()
    }

    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '3', PEER_VALIDATION_MAX_CONCURRENT_PER_CLIENT: '2' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      holdCatalyst()
      held = []
    })

    afterEach(async () => {
      release(undefined)
      await Promise.all(held)
    })

    describe('and anonymous callers have filled their pool', () => {
      beforeEach(async () => {
        held = [
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['198.51.100.1'] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['198.51.100.2'] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['198.51.100.3'] })
        ]
        await settle()
      })

      it('should refuse another anonymous caller', async () => {
        await expect(adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['198.51.100.4'] })).resolves.toEqual({
          ok: false,
          message: 'Could not validate the signature on chain'
        })
        expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached', pool: 'anonymous' })
      })

      it('should still let the login handoff through, since it draws from its own budget', async () => {
        const login = adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: [OWNER] })
        await settle()
        release(undefined)

        await expect(login).resolves.toEqual({ ok: true })
        expect(fetchMock).toHaveBeenCalledTimes(4)
      })
    })

    describe('and one client already holds its share of the pool', () => {
      beforeEach(async () => {
        held = [adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS), adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)]
        await settle()
      })

      it('should refuse that client another slot, even with room left in the pool', async () => {
        await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({
          ok: false,
          message: 'Could not validate the signature on chain'
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'client_cap_reached', pool: 'anonymous' })
      })

      it('should still serve a different client from the room that is left', async () => {
        const other = adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['198.51.100.9'] })
        await settle()
        release(undefined)

        await expect(other).resolves.toEqual({ ok: true })
      })

      it('should give the client its slot back once one of its calls finishes, so a retry gets through', async () => {
        release(undefined)
        await Promise.all(held)

        await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
      })
    })

    describe('and one address has minted fresh accounts to hold its share of the login budget', () => {
      beforeEach(async () => {
        held = [
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xa', 'ip:198.51.100.1'] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xb', 'ip:198.51.100.1'] })
        ]
        await settle()
      })

      it('should refuse a third account from that address, since the address is counted too', async () => {
        await expect(
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xc', 'ip:198.51.100.1'] })
        ).resolves.toEqual({ ok: false, message: 'Could not validate the signature on chain' })
        expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', {
          reason: 'client_cap_reached',
          pool: 'authenticated'
        })
      })

      it('should still serve a real login from another address', async () => {
        const login = adapter.validateOnChain(authChain, EPHEMERAL, {
          pool: 'authenticated',
          clientKeys: [`account:${OWNER}`, 'ip:203.0.113.5']
        })
        await settle()
        release(undefined)

        await expect(login).resolves.toEqual({ ok: true })
      })
    })

    describe('and one account is spread over several addresses', () => {
      beforeEach(async () => {
        held = [
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xa', 'ip:198.51.100.1'] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xa', 'ip:198.51.100.2'] })
        ]
        await settle()
      })

      it('should refuse it a third slot, since the account is counted too', async () => {
        await expect(
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: ['account:0xa', 'ip:198.51.100.3'] })
        ).resolves.toEqual({ ok: false, message: 'Could not validate the signature on chain' })
      })
    })

    describe('and a caller passes the same key twice', () => {
      beforeEach(async () => {
        held = [adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['ip:198.51.100.1', 'ip:198.51.100.1'] })]
        await settle()
      })

      it('should count it once, so the client keeps its second slot', async () => {
        const second = adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: ['ip:198.51.100.1'] })
        await settle()
        release(undefined)

        await expect(second).resolves.toEqual({ ok: true })
      })
    })

    describe('and no trusted client address could be established', () => {
      beforeEach(async () => {
        held = [
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: [] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: [] })
        ]
        await settle()
      })

      it('should apply only the pool cap, rather than counting every such caller as one client', async () => {
        const third = adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: [] })
        await settle()
        release(undefined)

        await expect(third).resolves.toEqual({ ok: true })
      })
    })

    describe('and the same account signs in from both pools', () => {
      beforeEach(async () => {
        held = [
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: [OWNER] }),
          adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'anonymous', clientKeys: [OWNER] })
        ]
        await settle()
      })

      it('should count its share per pool, not across them', async () => {
        const login = adapter.validateOnChain(authChain, EPHEMERAL, { pool: 'authenticated', clientKeys: [OWNER] })
        await settle()
        release(undefined)

        await expect(login).resolves.toEqual({ ok: true })
      })
    })
  })

  describe('when a client has made many validations one after another', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '2', PEER_VALIDATION_MAX_CONCURRENT_PER_CLIENT: '1' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should never run out, since the limit counts calls in flight rather than calls made', async () => {
      for (let i = 0; i < 20; i++) {
        await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
      }
    })
  })

  describe('when the signed-fetch middleware borrows the deadline', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_VALIDATION_TIMEOUT_IN_MILLISECONDS: '20' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
    })

    it('should expose the configured Catalyst origin for it to call', async () => {
      config.getString = givenStrings({ PEER_URL: 'https://peer.decentraland.zone/some/path' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })

      expect(adapter.peerOrigin).toBe('https://peer.decentraland.zone')
    })

    it('should hand its request an abort controller, keeping what the middleware passed', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => '{}' })

      await adapter.deadlineFetcher.fetch('https://peer.decentraland.org/lambdas/crypto/validate-signature', {
        method: 'POST',
        body: '{}'
      })

      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', body: '{}' }))
      expect(fetchMock.mock.calls[0][1].abortController).toBeInstanceOf(AbortController)
    })

    it('should hand back the answer already read, so the middleware can still parse it', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => '{"valid":true}' })

      const response = await adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })

      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('{"valid":true}')
    })

    it('should abort a call that outlives the deadline', async () => {
      fetchMock.mockImplementation(
        (_url: string, options: { abortController: AbortController }) =>
          new Promise((_resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => reject(new Error('Request aborted (timed out)')))
          })
      )

      await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).rejects.toThrow(
        'Request aborted (timed out)'
      )
    })

    it('should abort a body that stalls after its headers, since the body is read inside the deadline', async () => {
      fetchMock.mockImplementation(async (_url: string, options: { abortController: AbortController }) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise((_resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
          })
      }))

      await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).rejects.toThrow(
        'The operation was aborted'
      )
    })

    describe('and as many signed-fetch checks are in flight as the pool allows', () => {
      let openGate: () => void
      let held: Promise<Response>[]

      beforeEach(async () => {
        config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '2' })
        adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
        const gate = new Promise<void>(resolve => {
          openGate = resolve
        })
        fetchMock.mockImplementation(async () => {
          await gate
          return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => '{}' }
        })
        held = [
          adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' }),
          adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })
        ]
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })

      afterEach(async () => {
        openGate()
        await Promise.all(held)
      })

      it('should refuse the next one at once, which the middleware answers with a 503', async () => {
        await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).rejects.toThrow(
          'Too many signature validations in flight'
        )
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'cap_reached', pool: 'signed_fetch' })
      })

      it('should not take slots from the handlers, which keep their own pools', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })

        await expect(adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)).resolves.toEqual({ ok: true })
      })

      it('should free a slot as soon as a check finishes, rather than holding it for the whole deadline', async () => {
        openGate()
        await Promise.all(held)

        await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).resolves.toBeInstanceOf(Response)
      })
    })

    describe('and one client holds its share of the signed-fetch budget', () => {
      let openGate: () => void
      let held: Promise<Response>[]

      const checkAs = (clientKeys: string[]) =>
        adapter.withSignedFetchCaller(clientKeys, () =>
          adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })
        )

      beforeEach(async () => {
        config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '5', PEER_VALIDATION_MAX_CONCURRENT_PER_CLIENT: '2' })
        adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
        const gate = new Promise<void>(resolve => {
          openGate = resolve
        })
        fetchMock.mockImplementation(async () => {
          await gate
          return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => '{}' }
        })
        held = [checkAs(['ip:198.51.100.1']), checkAs(['ip:198.51.100.1'])]
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })

      afterEach(async () => {
        openGate()
        await Promise.all(held)
      })

      it('should refuse that client another check, so it cannot fill the budget for everyone', async () => {
        await expect(checkAs(['ip:198.51.100.1'])).rejects.toThrow('Too many signature validations in flight')
        expect(increment).toHaveBeenCalledWith('signature_validation_refused_total', { reason: 'client_cap_reached', pool: 'signed_fetch' })
      })

      it('should still check a different client', async () => {
        const other = checkAs(['ip:203.0.113.5'])
        for (let i = 0; i < 5; i++) await Promise.resolve()
        openGate()

        await expect(other).resolves.toBeInstanceOf(Response)
      })
    })

    describe('and the Catalyst answers with an error status', () => {
      let cancel: jest.Mock

      beforeEach(() => {
        cancel = jest.fn().mockResolvedValue(undefined)
        fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', body: { cancel }, text: jest.fn() })
      })

      it('should pass the status on, as the middleware expects', async () => {
        const response = await adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })

        expect(response.ok).toBe(false)
        expect(response.status).toBe(503)
      })

      it('should cancel the body rather than read it, as the middleware would have', async () => {
        await adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })

        expect(cancel).toHaveBeenCalledTimes(1)
      })
    })

    describe('and the Catalyst answers a status that carries no body', () => {
      it('should hand back an empty answer rather than fail to build one', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', headers: new Headers(), text: async () => '' })

        const response = await adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })

        expect(response.status).toBe(204)
      })
    })

    describe('and a check fails outright', () => {
      beforeEach(async () => {
        config.getString = givenStrings({ PEER_VALIDATION_MAX_CONCURRENT: '1' })
        adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      })

      it('should give its slot back', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network down'))
        await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).rejects.toThrow('network down')

        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => '{}' })
        await expect(adapter.deadlineFetcher.fetch('https://peer.decentraland.org/x', { method: 'POST' })).resolves.toBeInstanceOf(Response)
      })
    })
  })

  describe('when a Catalyst is configured', () => {
    beforeEach(async () => {
      config.getString = givenStrings({ PEER_URL: 'https://peer-ec1.decentraland.org/' })
      adapter = await createSignatureValidatorAdapter({ config, fetch, logs, metrics })
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, ownerAddress: OWNER }) })
    })

    it('should use it, without doubling the slash before the path', async () => {
      await adapter.validateOnChain(authChain, EPHEMERAL, ANONYMOUS)

      expect(fetchMock.mock.calls[0][0]).toBe('https://peer-ec1.decentraland.org/lambdas/crypto/validate-signature')
    })
  })
})
