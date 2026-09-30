import { AuthIdentity } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import { signedHeaderFactory } from 'decentraland-crypto-fetch'
import { test } from '../components'
import { createAuthWsClient, createHttpClient, HttpPollingClient } from '../utils'
import { asContractAccountChain, contractAccountThat } from '../utils/l1-provider'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity } from '../utils/test-identity'

test('when an account with code behind it signs in', args => {
  let port: string
  let identity: AuthIdentity
  let authChain: AuthChain
  let sendAsync: jest.Mock

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    identity = await createTestIdentity()
    authChain = asContractAccountChain(identity.authChain)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- sendAsync is a mock, never invoked as a method here
    sendAsync = args.components.l1Provider.sendAsync as jest.Mock
    // `resetMocks` clears the mock's implementation before every test, so the default — every RPC
    // call fails — is restored here; each case that needs an answer programs its own.
    sendAsync.mockImplementation((_payload, callback) => callback(new Error('No RPC in tests')))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and it stores its identity', () => {
    let contractIdentity: AuthIdentity
    let response: Response

    beforeEach(() => {
      contractIdentity = { ...identity, authChain }
    })

    const storeIdentity = () =>
      createSignedFetchRequest(`http://localhost:${port}`, {
        method: 'POST',
        path: '/identities',
        body: { identity: contractIdentity },
        identity: contractIdentity
      })

    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should store it', async () => {
        response = await storeIdentity()

        expect(response.status).toBe(201)
      })

      it('should validate both the signed-fetch headers and the identity body on the configured provider', async () => {
        await storeIdentity()

        expect(sendAsync).toHaveBeenCalledTimes(2)
      })

      describe('and the ephemeral signed-fetch signature is tampered with', () => {
        let headers: Headers
        let entityLink: { type: string; payload: string; signature: string }

        beforeEach(() => {
          headers = signedHeaderFactory()(contractIdentity, 'POST', '/identities', {})
          entityLink = JSON.parse(headers.get('x-identity-auth-chain-2') ?? '{}')
          entityLink.signature = '0x' + '00'.repeat(65)
          headers.set('x-identity-auth-chain-2', JSON.stringify(entityLink))
          headers.set('content-type', 'application/json')
        })

        it('should reject the request even though the contract accepts its delegation signature', async () => {
          response = await fetch(`http://localhost:${port}/identities`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ identity: contractIdentity })
          })

          expect(response.status).toBe(401)
        })
      })
    })

    describe('and the account rejects the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('rejects'))
      })

      it('should refuse it', async () => {
        response = await storeIdentity()

        expect(response.status).toBe(401)
      })
    })

    describe('and the provider cannot be reached', () => {
      it('should refuse it', async () => {
        response = await storeIdentity()

        expect(response.status).toBe(401)
      })
    })

    describe('and the identity was signed by a plain EOA instead', () => {
      beforeEach(() => {
        contractIdentity = identity
      })

      it('should store it without calling the provider', async () => {
        response = await storeIdentity()

        expect(response.status).toBe(201)
        expect(sendAsync).not.toHaveBeenCalled()
      })
    })
  })

  describe('and it registers a request over HTTP', () => {
    let client: HttpPollingClient

    beforeEach(async () => {
      client = await createHttpClient(port)
    })

    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should register it', async () => {
        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          requestId: expect.any(String),
          expiration: expect.any(String),
          code: expect.any(Number)
        })
      })
    })

    describe('and the provider cannot be reached', () => {
      it('should refuse it', async () => {
        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: expect.any(String)
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

    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should register it', async () => {
        await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          requestId: expect.any(String),
          expiration: expect.any(String),
          code: expect.any(Number)
        })
      })
    })
  })

  describe('and every link was signed by a plain EOA instead', () => {
    let client: HttpPollingClient

    beforeEach(async () => {
      client = await createHttpClient(port)
    })

    it('should validate it without calling the provider', async () => {
      await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain: identity.authChain })).resolves.toEqual({
        requestId: expect.any(String),
        expiration: expect.any(String),
        code: expect.any(Number)
      })
      expect(sendAsync).not.toHaveBeenCalled()
    })
  })
})
