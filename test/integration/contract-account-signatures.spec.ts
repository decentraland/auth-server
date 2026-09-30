import { AuthIdentity } from '@dcl/crypto'
import { AuthChain } from '@dcl/schemas'
import { test } from '../components'
import { createAuthWsClient, createHttpClient } from '../utils'
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

  describe('and it stores its identity', () => {
    const storeIdentity = () =>
      createSignedFetchRequest(`http://localhost:${port}`, {
        method: 'POST',
        path: '/identities',
        body: { identity: { ...identity, authChain } },
        identity
      })

    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should store it', async () => {
        const response = await storeIdentity()

        expect(response.status).toBe(201)
      })
    })

    describe('and the account rejects the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('rejects'))
      })

      it('should refuse it', async () => {
        const response = await storeIdentity()

        expect(response.status).toBe(400)
      })
    })
  })

  describe('and it registers a request over HTTP', () => {
    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should register it', async () => {
        const client = await createHttpClient(port)

        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          requestId: expect.any(String),
          expiration: expect.any(String),
          code: expect.any(Number)
        })
      })
    })

    describe('and the provider cannot be reached', () => {
      it('should refuse it', async () => {
        const client = await createHttpClient(port)

        await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
          error: expect.any(String)
        })
      })
    })
  })

  describe('and it registers a request over the socket', () => {
    describe('and the account accepts the signature', () => {
      beforeEach(() => {
        sendAsync.mockImplementation(contractAccountThat('accepts'))
      })

      it('should register it', async () => {
        const socket = await createAuthWsClient(port)
        try {
          await expect(socket.emitWithAck('request', { method: 'eth_sendTransaction', params: [], authChain })).resolves.toEqual({
            requestId: expect.any(String),
            expiration: expect.any(String),
            code: expect.any(Number)
          })
        } finally {
          socket.disconnect()
        }
      })
    })
  })

  describe('and every link was signed by a plain EOA instead', () => {
    it('should validate it without calling the provider', async () => {
      const client = await createHttpClient(port)

      await expect(client.request({ method: 'eth_sendTransaction', params: [], authChain: identity.authChain })).resolves.toEqual({
        requestId: expect.any(String),
        expiration: expect.any(String),
        code: expect.any(Number)
      })
      expect(sendAsync).not.toHaveBeenCalled()
    })
  })
})
