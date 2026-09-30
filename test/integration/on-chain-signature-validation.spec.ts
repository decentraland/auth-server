import { io } from 'socket.io-client'
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
  jest.fn().mockResolvedValue(catalystResponse(body))

// `json` for the signature validator, `text` for the signed-fetch middleware, which parses the body itself.
const catalystResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

/** A Cloudflare edge address, as the load balancer records the hop that connected to it. */
const CLOUDFLARE_EDGE = '162.158.10.20'

/** Headers of a request that came through Cloudflare on behalf of `client`. */
const viaCloudflare = (client: string) => ({ 'x-forwarded-for': `${client}, ${CLOUDFLARE_EDGE}`, 'cf-connecting-ip': client })

/** Headers of a request sent straight to the load balancer from `hop`, claiming to be `claimed`. */
const aroundCloudflare = (hop: string, claimed: string) => ({ 'x-forwarded-for': hop, 'cf-connecting-ip': claimed })

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

    describe('and the Catalyst turns the signature down', () => {
      beforeEach(() => {
        fetchMock.mockImplementation(catalystAnswers({ valid: false, error: 'Invalid signature' }))
      })

      it('should refuse it with the reason the Catalyst gave', async () => {
        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: 'Invalid signature'
        })
      })
    })

    describe('and its ephemeral payload has expired', () => {
      beforeEach(async () => {
        const expired = await createTestIdentity(-1)
        authChain = asSmartAccountChain(expired.authChain)
        fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: expired.authChain[0].payload }))
      })

      it('should refuse it without spending a Catalyst call', async () => {
        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: 'Ephemeral payload has expired'
        })
        expect(fetchMock).not.toHaveBeenCalled()
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

    describe('and the Catalyst cannot be reached', () => {
      beforeEach(() => {
        fetchMock.mockRejectedValue(new Error('network down'))
      })

      it('should fail closed over the socket too', async () => {
        await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: 'Could not validate the signature on chain'
        })
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

  describe('and it stores an identity whose chain names no owner', () => {
    const chains: [string, (chain: AuthChain) => AuthChain][] = [
      ['is empty', () => []],
      ['does not start with a SIGNER link', chain => chain.slice(1)]
    ]

    beforeEach(() => {
      fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))
    })

    it.each(chains)('should reject a chain that %s as malformed (400), not as a sender mismatch', async (_shape, build) => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: { ...identity, authChain: build(authChain) } },
        identity
      })

      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should keep the message an empty chain always had', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: { ...identity, authChain: [] } },
        identity
      })

      await expect(response.json()).resolves.toEqual({ error: 'Auth chain is required' })
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

  describe('and the Catalyst is slow to answer', () => {
    let openGate: () => void
    let inFlight: Promise<unknown>[]

    const postRequest = (headers: Record<string, string>) =>
      fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
        body: JSON.stringify({ method: 'eth_sendTransaction', params: [], authChain })
      }).then(response => response.json())

    // Waits until `count` validations are actually held at the Catalyst, instead of sleeping and
    // hoping they got there, so the assertions that follow never race the requests they depend on.
    const catalystHolds = async (count: number) => {
      const deadline = Date.now() + 5000
      while (fetchMock.mock.calls.length < count) {
        if (Date.now() > deadline) throw new Error(`Only ${fetchMock.mock.calls.length} of ${count} validations reached the Catalyst`)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    }

    beforeEach(() => {
      const gate = new Promise<void>(resolve => {
        openGate = resolve
      })
      fetchMock.mockImplementation(async () => {
        await gate
        return catalystResponse({ valid: true, ownerAddress: owner })
      })
      inFlight = []
    })

    afterEach(async () => {
      openGate()
      await Promise.all(inFlight)
    })

    describe('and anonymous callers hold every slot of their budget', () => {
      beforeEach(async () => {
        // The default budget is 10 slots per pool and 3 per client: ten clients fill the pool.
        inFlight = Array.from({ length: 10 }, (_, i) => postRequest(viaCloudflare(`198.51.100.${i + 1}`)))
        await catalystHolds(10)
      })

      it('should turn away one more anonymous request', async () => {
        await expect(postRequest(viaCloudflare('198.51.100.200'))).resolves.toEqual({
          error: 'Could not validate the signature on chain'
        })
      })

      it('should turn away the socket too, since it draws from the same anonymous budget', async () => {
        const socket = io(`http://localhost:${port}`, { extraHeaders: viaCloudflare('198.51.100.201') })
        try {
          await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
            error: 'Could not validate the signature on chain'
          })
        } finally {
          socket.disconnect()
        }
      })

      it('should still accept the login handoff, which draws from its own budget', async () => {
        fetchMock.mockImplementation(catalystAnswers({ valid: true, ownerAddress: owner }))

        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: { identity: { ...identity, authChain } },
          identity,
          headers: viaCloudflare('203.0.113.5')
        })

        expect(response.status).toBe(201)
      })
    })

    describe('and one client holds as many anonymous validations as it is allowed', () => {
      beforeEach(async () => {
        inFlight = Array.from({ length: 3 }, () => postRequest(viaCloudflare('203.0.113.50')))
        await catalystHolds(3)
      })

      it('should refuse that client another one', async () => {
        await expect(postRequest(viaCloudflare('203.0.113.50'))).resolves.toEqual({ error: 'Could not validate the signature on chain' })
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })

      it('should serve a different client, so one busy client does not block its neighbours', async () => {
        const response = postRequest(viaCloudflare('203.0.113.51'))
        await catalystHolds(4)
        openGate()

        await expect(response).resolves.toEqual({ requestId: expect.any(String), expiration: expect.any(String), code: expect.any(Number) })
      })

      it('should refuse it over a socket as well, since sockets are counted by the same address', async () => {
        const socket = io(`http://localhost:${port}`, { extraHeaders: viaCloudflare('203.0.113.50') })
        try {
          await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
            error: 'Could not validate the signature on chain'
          })
        } finally {
          socket.disconnect()
        }
      })
    })

    describe('and a client goes around Cloudflare and makes up a new address on every request', () => {
      beforeEach(async () => {
        inFlight = ['10.0.0.1', '10.0.0.2', '10.0.0.3'].map(claimed => postRequest(aroundCloudflare('198.51.100.77', claimed)))
        await catalystHolds(3)
      })

      it('should still count it as the one address that connected', async () => {
        await expect(postRequest(aroundCloudflare('198.51.100.77', '10.0.0.4'))).resolves.toEqual({
          error: 'Could not validate the signature on chain'
        })
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })
    })

    describe('and one client signs in with fresh accounts to hold the login budget', () => {
      let minted: AuthIdentity[]

      const storeIdentityOf = (account: AuthIdentity, client: string) =>
        createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: { identity: { ...account, authChain: asSmartAccountChain(account.authChain) } },
          identity: account,
          headers: viaCloudflare(client)
        })

      beforeEach(async () => {
        minted = await Promise.all(Array.from({ length: 4 }, () => createTestIdentity()))
        inFlight = minted.slice(0, 3).map(account => storeIdentityOf(account, '198.51.100.90'))
        await catalystHolds(3)
      })

      it('should refuse a fourth account from that client, since the address is counted as well as the account', async () => {
        const response = await storeIdentityOf(minted[3], '198.51.100.90')

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({ error: 'Could not validate the signature on chain' })
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('and one client holds its share of the signed-fetch checks', () => {
    let openGate: () => void
    let held: Promise<Response>[]

    // A signed fetch whose own chain names a smart account: the middleware asks the Catalyst about
    // it before the handler runs. The signer needs no key for that check to happen.
    const signedFetchFrom = (account: AuthIdentity, client: string) => {
      const smart = { ...account, authChain: asSmartAccountChain(account.authChain) }
      return createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: smart },
        identity: smart,
        headers: viaCloudflare(client)
      })
    }

    const middlewareChecks = () => fetchMock.mock.calls.filter(([, init]) => 'timestamp' in JSON.parse(init.body)).length

    beforeEach(async () => {
      const gate = new Promise<void>(resolve => {
        openGate = resolve
      })
      let answered = 0
      // The first three checks (the flooding client's) are held; everything after answers at once.
      fetchMock.mockImplementation(async () => {
        if (answered++ < 3) await gate
        return catalystResponse({ valid: true, ownerAddress: owner })
      })
      const attackers = await Promise.all(Array.from({ length: 3 }, () => createTestIdentity()))
      held = attackers.map(account => signedFetchFrom(account, '198.51.100.66'))
      const deadline = Date.now() + 5000
      while (middlewareChecks() < 3) {
        if (Date.now() > deadline) throw new Error('The flooding checks never reached the Catalyst')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    })

    afterEach(async () => {
      openGate()
      await Promise.all(held)
    })

    it('should refuse that client a fourth check (503)', async () => {
      const response = await signedFetchFrom(await createTestIdentity(), '198.51.100.66')

      expect(response.status).toBe(503)
    })

    it('should still sign in a smart account from another client', async () => {
      const response = await signedFetchFrom(identity, '203.0.113.5')

      expect(response.status).toBe(201)
    })
  })

  describe('and the request itself is signed with its smart-account chain', () => {
    beforeEach(() => {
      fetchMock.mockImplementation(async () => catalystResponse({ valid: true, ownerAddress: owner }))
    })

    it('should have the signed-fetch middleware ask the configured Catalyst, under a deadline', async () => {
      await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: { ...identity, authChain } },
        identity: { ...identity, authChain }
      })

      const middlewareCall = fetchMock.mock.calls.find(([, init]) => 'timestamp' in JSON.parse(init.body))
      expect(middlewareCall?.[0]).toBe(VALIDATE_SIGNATURE_URL)
      expect(middlewareCall?.[1].abortController).toBeInstanceOf(AbortController)
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
