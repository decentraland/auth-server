import { AuthIdentity } from '@dcl/crypto'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { test } from '../components'
import { createAuthWsClient, createHttpClient, HttpPollingClient } from '../utils'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity } from '../utils/test-identity'

const VALIDATE_SIGNATURE_URL = 'https://peer.decentraland.org/lambdas/crypto/validate-signature'

/**
 * The same chain, but with its ephemeral link marked as signed by an account with code behind it —
 * a contract wallet, or an EOA delegated through EIP-7702. That is what routes the chain to the
 * Catalyst instead of `ecrecover`, and reproducing it takes no contract: the link type is what the
 * service classifies on. The owner is untouched, so the chain still belongs to the same account.
 */
const asSmartAccountChain = (authChain: AuthChain): AuthChain => [
  ...authChain.slice(0, -1),
  { ...authChain[authChain.length - 1], type: AuthLinkType.ECDSA_EIP_1654_EPHEMERAL }
]

/**
 * The Catalyst's answer. `ownerAddress` is part of it because the adapter checks the verdict is
 * about the account that signed the chain, the same way `@dcl/crypto-middleware` does.
 */
const catalystAnswers = (body: { valid: boolean; ownerAddress?: string; error?: string }) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })

test('when an account with code behind it signs in', args => {
  let port: string
  let baseUrl: string
  let identity: AuthIdentity
  let authChain: AuthChain
  let owner: string
  let fetchMock: jest.Mock

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    identity = await createTestIdentity()
    authChain = asSmartAccountChain(identity.authChain)
    owner = identity.authChain[0].payload
    // eslint-disable-next-line @typescript-eslint/unbound-method -- fetch is a mock, never invoked as a method here
    fetchMock = args.components.fetch.fetch as jest.Mock
    fetchMock.mockReset()
  })

  describe('and it stores its identity', () => {
    let body: { identity: AuthIdentity }

    beforeEach(() => {
      body = { identity: { ...identity, authChain } }
    })

    describe('and the Catalyst confirms the signature', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))
      })

      it('should accept it, which is what a plain provider-less check could never do', async () => {
        const response = await createSignedFetchRequest(baseUrl, { method: 'POST', path: '/identities', body, identity })

        expect(response.status).toBe(201)
      })

      it('should have asked the Catalyst rather than resolved it locally', async () => {
        await createSignedFetchRequest(baseUrl, { method: 'POST', path: '/identities', body, identity })

        expect(fetchMock.mock.calls[0][0]).toBe(VALIDATE_SIGNATURE_URL)
      })
    })

    describe('and the Catalyst turns the signature down', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: false, error: 'Invalid signature' }))
      })

      it('should refuse it with the reason the Catalyst gave', async () => {
        const response = await createSignedFetchRequest(baseUrl, { method: 'POST', path: '/identities', body, identity })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({ error: 'Invalid signature' })
      })
    })
  })

  describe('and it registers a request over HTTP', () => {
    let client: HttpPollingClient

    beforeEach(async () => {
      client = await createHttpClient(port)
    })

    describe('and the Catalyst confirms the signature', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))
      })

      it('should register it, with the validator reached through the handler wiring', async () => {
        const response = await client.request({ method: 'eth_sendTransaction', params: [], authChain })

        expect(response).toEqual({ requestId: expect.any(String), expiration: expect.any(String), code: expect.any(Number) })
        expect(fetchMock.mock.calls[0][0]).toBe(VALIDATE_SIGNATURE_URL)
      })
    })

    describe('and the Catalyst cannot be reached', () => {
      beforeEach(() => {
        fetchMock.mockRejectedValue(new Error('network down'))
      })

      it('should fail closed, since an unverified signature is not an accepted one', async () => {
        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: 'Could not validate the signature on chain'
        })
      })
    })
  })

  describe('and it registers a request over the socket', () => {
    let socket: Awaited<ReturnType<typeof createAuthWsClient>>

    beforeEach(async () => {
      socket = await createAuthWsClient(port)
    })

    afterEach(() => {
      socket.disconnect()
    })

    describe('and the Catalyst confirms the signature', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))
      })

      it('should register it, so the socket path is wired to the validator too', async () => {
        const response = await socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })

        expect(response).toEqual({ requestId: expect.any(String), expiration: expect.any(String), code: expect.any(Number) })
        expect(fetchMock.mock.calls[0][0]).toBe(VALIDATE_SIGNATURE_URL)
      })
    })

    describe('and the Catalyst turns the signature down', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: false, error: 'Invalid signature' }))
      })

      it('should refuse it with the reason the Catalyst gave', async () => {
        await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: 'Invalid signature'
        })
      })
    })
  })

  describe('and someone else signs the request that carries its chain', () => {
    let otherIdentity: AuthIdentity

    beforeEach(async () => {
      otherIdentity = await createTestIdentity()
      fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))
    })

    it('should refuse it before spending a Catalyst call on a chain the caller does not own', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: { ...identity, authChain } },
        identity: otherIdentity
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Request sender does not match identity owner' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('and every link was signed by a plain EOA instead', () => {
    let client: HttpPollingClient

    beforeEach(async () => {
      client = await createHttpClient(port)
    })

    it('should settle it offline, so an ordinary login never depends on the Catalyst', async () => {
      const response = await client.request({ method: 'eth_sendTransaction', params: [], authChain: identity.authChain })

      expect(response).toEqual({ requestId: expect.any(String), expiration: expect.any(String), code: expect.any(Number) })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
