import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { AUTH_CHAIN_HEADER_PREFIX, AUTH_METADATA_HEADER, AUTH_TIMESTAMP_HEADER } from '@dcl/crypto-middleware'
import { IMagicAdapter } from '../../src/adapters/magic'
import { test } from '../components'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

/**
 * Pins that callers still on the pre-6.0.0 payload can delete an account.
 *
 * They fold the whole joined string before signing -- `[method, path, timestamp, metadata].join(':')
 * .toLowerCase()` -- while delivering the metadata header verbatim. Since 6.0.0 the metadata bytes
 * are signed as delivered, so the two disagree for any metadata carrying uppercase.
 *
 * `DELETE /accounts` carries `didToken`: an uppercase key, and a token value that is mixed-case by
 * construction. `sites` is the only caller and still resolves `decentraland-crypto-fetch` 2.0.1
 * transitively, so without the declared key list account deletion is a 401 on every attempt.
 *
 * The rest of the suite signs through `decentraland-crypto-fetch` 3.0.0, which is why it stayed
 * green against a format no caller sends. These build the folded payload by hand instead.
 */
const PATH = '/accounts'
const ALLOWED_ORIGIN = 'https://account.decentraland.org'

test('when a caller signs the pre-6.0.0 folded payload', args => {
  let baseUrl: string
  let identity: AuthIdentity
  let signer: string
  let didToken: string
  let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    identity = await createTestIdentity()
    signer = Authenticator.ownerAddress(identity.authChain).toLowerCase()

    const tid = generateRandomIdentityId()
    // Mixed case on purpose: it is what makes the folded payload disagree with the delivered header.
    didToken = `did-token-FaKe-${tid}`

    magic = args.components.magic as jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
    magic.validateDidToken.mockReturnValue({
      address: signer,
      issuer: `did:ethr:${signer}`,
      iat: Math.floor(Date.now() / 1000),
      tid
    })
    magic.requestUserDeletion.mockResolvedValue({ processed: [signer], unprocessed: [] })
  })

  /**
   * Rewrites one key's spelling while keeping every key in place.
   *
   * Order matters: the folded payload covers the serialized metadata, so moving a key changes the
   * signed bytes and the request fails on the signature instead of on the spelling under test.
   */
  function respell(metadata: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key === from ? to : key, value]))
  }

  /** Signs `metadata` folded, then delivers `delivered` (defaulting to the same) verbatim. */
  function legacyRequest(metadata: Record<string, unknown>, delivered?: Record<string, unknown>): Promise<Response> {
    const timestamp = Date.now()
    const payload = ['DELETE', PATH, timestamp.toString(), JSON.stringify(metadata)].join(':').toLowerCase()
    const chain = Authenticator.signPayload(
      {
        ephemeralIdentity: identity.ephemeralIdentity,
        expiration: new Date(identity.expiration),
        authChain: identity.authChain
      },
      payload
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      origin: ALLOWED_ORIGIN,
      [AUTH_TIMESTAMP_HEADER]: timestamp.toString(),
      [AUTH_METADATA_HEADER]: JSON.stringify(delivered ?? metadata)
    }
    chain.forEach((link, index) => {
      headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
    })

    return fetch(`${baseUrl}${PATH}`, { method: 'DELETE', headers })
  }

  describe('and the metadata is delivered as signed', () => {
    let response: Response

    beforeEach(async () => {
      response = await legacyRequest({ didToken })
    })

    it('should respond with 200 and report the deletion result', async () => {
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        deleted: true,
        address: signer,
        magic: { processed: [signer], unprocessed: [] }
      })
    })

    it('should hand Magic the token with its original casing', async () => {
      // Accepting the older signature does not rewrite what the handler goes on to read: the token
      // is only usable if it reaches Magic byte-for-byte as the caller sent it.
      expect(magic.validateDidToken).toHaveBeenCalledWith(didToken)
    })
  })

  describe('and the delivered metadata re-spells didToken', () => {
    let response: Response

    beforeEach(async () => {
      response = await legacyRequest({ didToken }, respell({ didToken }, 'didToken', 'didtoken'))
    })

    it('should be refused rather than read as carrying no token', async () => {
      // Folded, `didtoken` signs identically to `didToken`. Read as absent it would fail schema
      // validation as a 400 with a confusing message; refusing the ambiguity is the honest answer.
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        message: 'This endpoint requires a signed fetch request. See ADR-44.'
      })
    })

    it('should never reach Magic', async () => {
      expect(magic.validateDidToken).not.toHaveBeenCalled()
    })
  })

  describe('and the delivered metadata re-spells the signer', () => {
    let response: Response

    beforeEach(async () => {
      const metadata = { signer: 'dcl:explorer', didToken }
      response = await legacyRequest(metadata, respell(metadata, 'signer', 'Signer'))
    })

    it('should be refused rather than read as carrying no signer', async () => {
      // `rejectIfSigner` gates on this key, and the fold leaves its casing outside the signature, so
      // without the declared spelling the gate would read the field as absent.
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        message: 'This endpoint requires a signed fetch request. See ADR-44.'
      })
    })
  })

  describe('and the request carries the scene signer', () => {
    let response: Response

    beforeEach(async () => {
      response = await legacyRequest({ signer: 'decentraland-kernel-scene', didToken })
    })

    it('should still be refused, so the fallback has not widened who may call', async () => {
      expect(response.status).toBe(400)
    })

    it('should never reach Magic', async () => {
      expect(magic.validateDidToken).not.toHaveBeenCalled()
    })
  })
})
