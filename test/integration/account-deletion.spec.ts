import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { IMagicAdapter, MagicTokenInvalidError } from '../../src/adapters/magic'
import { test } from '../components'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

test('when deleting a Magic account', args => {
  let baseUrl: string
  let allowedOrigin: string

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    allowedOrigin = 'https://account.decentraland.org'
  })

  describe('and the request is a valid signed fetch with a fresh DID token from an allowed origin', () => {
    let identity: AuthIdentity
    let signer: string
    let didToken: string
    let tid: string
    let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

    beforeEach(async () => {
      identity = await createTestIdentity()
      signer = Authenticator.ownerAddress(identity.authChain).toLowerCase()
      tid = generateRandomIdentityId()
      didToken = `did-token-${tid}`
      magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
      magic.validateDidToken.mockReturnValue({ address: signer, issuer: `did:ethr:${signer}`, iat: Math.floor(Date.now() / 1000), tid })
      magic.requestUserDeletion.mockResolvedValue({ processed: [signer], unprocessed: [] })
      ;(args.components.db.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
    })

    it('should respond with 200 and report the deletion result', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(response.status).toBe(200)
      const responseBody = await response.json()
      expect(responseBody).toEqual({ deleted: true, address: signer, magic: { processed: [signer], unprocessed: [] } })
    })

    it('should request the deletion from Magic with the recovered address', async () => {
      await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(magic.requestUserDeletion).toHaveBeenCalledWith(signer)
    })

    it('should purge local onboarding data for the address', async () => {
      const spy = jest.spyOn(args.components.onboarding, 'deleteByWallet')

      await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(spy).toHaveBeenCalledWith(signer)
    })
  })

  describe('and the same DID token is used twice', () => {
    let identity: AuthIdentity
    let signer: string
    let didToken: string
    let tid: string
    let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

    beforeEach(async () => {
      identity = await createTestIdentity()
      signer = Authenticator.ownerAddress(identity.authChain).toLowerCase()
      tid = generateRandomIdentityId()
      didToken = `did-token-${tid}`
      magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
      magic.validateDidToken.mockReturnValue({ address: signer, issuer: `did:ethr:${signer}`, iat: Math.floor(Date.now() / 1000), tid })
      magic.requestUserDeletion.mockResolvedValue({ processed: [signer], unprocessed: [] })
      ;(args.components.db.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
    })

    it('should respond with 403 on the second attempt', async () => {
      const first = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })
      expect(first.status).toBe(200)

      const second = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })
      expect(second.status).toBe(403)
    })
  })

  describe('and the DID token address does not match the request signer', () => {
    let identity: AuthIdentity
    let didToken: string
    let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

    beforeEach(async () => {
      identity = await createTestIdentity()
      didToken = `did-token-${generateRandomIdentityId()}`
      magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
      magic.validateDidToken.mockReturnValue({
        address: '0x1111111111111111111111111111111111111111',
        issuer: 'did:ethr:0x1111111111111111111111111111111111111111',
        iat: Math.floor(Date.now() / 1000),
        tid: generateRandomIdentityId()
      })
    })

    it('should respond with 403 and an address mismatch error', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(response.status).toBe(403)
      const responseBody = await response.json()
      expect(responseBody.error).toContain('does not match')
    })
  })

  describe('and the DID token is invalid', () => {
    let identity: AuthIdentity
    let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

    beforeEach(async () => {
      identity = await createTestIdentity()
      magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
      magic.validateDidToken.mockImplementation(() => {
        throw new MagicTokenInvalidError()
      })
    })

    it('should respond with 401', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken: 'invalid' },
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(response.status).toBe(401)
    })
  })

  describe('and the origin is not allowed', () => {
    let identity: AuthIdentity
    let didToken: string
    let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

    beforeEach(async () => {
      identity = await createTestIdentity()
      const signer = Authenticator.ownerAddress(identity.authChain).toLowerCase()
      didToken = `did-token-${generateRandomIdentityId()}`
      magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
      magic.validateDidToken.mockReturnValue({
        address: signer,
        issuer: `did:ethr:${signer}`,
        iat: Math.floor(Date.now() / 1000),
        tid: generateRandomIdentityId()
      })
    })

    it('should respond with 403 and an origin not allowed error', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: 'https://evil.example.com' }
      })

      expect(response.status).toBe(403)
      const responseBody = await response.json()
      expect(responseBody).toEqual({ error: 'Origin not allowed' })
    })

    it('should not request the deletion from Magic', async () => {
      await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: { didToken },
        identity,
        headers: { origin: 'https://evil.example.com' }
      })

      expect(magic.requestUserDeletion).not.toHaveBeenCalled()
    })
  })

  describe('and the request is not a signed fetch', () => {
    it('should respond requiring a signed fetch request', async () => {
      const response = await fetch(`${baseUrl}/accounts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', origin: 'https://account.decentraland.org' },
        body: JSON.stringify({ didToken: 'whatever' })
      })

      expect(response.status).toBe(400)
      const responseBody = await response.json()
      expect(responseBody.message).toBe('This endpoint requires a signed fetch request. See ADR-44.')
    })
  })

  describe('and the DID token is missing from the metadata', () => {
    let identity: AuthIdentity

    beforeEach(async () => {
      identity = await createTestIdentity()
    })

    it('should respond with 400', async () => {
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'DELETE',
        path: '/accounts',
        metadata: {},
        identity,
        headers: { origin: allowedOrigin }
      })

      expect(response.status).toBe(400)
    })
  })
})
