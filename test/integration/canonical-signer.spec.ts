import { AuthIdentity } from '@dcl/crypto'
import { AUTH_METADATA_HEADER } from '@dcl/crypto-middleware'
import { signedFetchFactory } from 'decentraland-crypto-fetch'
import { test } from '../components'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity } from '../utils/test-identity'

const SIGNED_METADATA = { signer: 'decentraland-kernel-scene' }
const DELIVERED_METADATA = JSON.stringify({ signer: 'Decentraland-Kernel-Scene' })

/**
 * Delivers a metadata header that differs from the one `signedFetch` actually signed. The signing
 * format joins the metadata bytes verbatim, so a value differing only in case no longer shares the
 * signature — but the gate must not depend on that alone: `rejectIfSigner` refuses the non-canonical
 * spelling outright, before the signature is ever checked. This is the attack, not a mock: nothing
 * here weakens the signature.
 */
function createTamperingFetch(deliveredMetadata: string): typeof fetch {
  return (async (input: Request): Promise<Response> => {
    const headers: Record<string, string> = {}
    input.headers.forEach((value, key) => {
      headers[key] = value
    })
    headers[AUTH_METADATA_HEADER] = deliveredMetadata
    const body = input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text()

    return fetch(input.url, { method: input.method, headers, body })
  }) as unknown as typeof fetch
}

test('when a request carries a scene signer', args => {
  let baseUrl: string
  let identity: AuthIdentity

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    identity = await createTestIdentity()
  })

  describe('and the canonical signer was signed but a mixed-case spelling is delivered', () => {
    let response: Response

    beforeEach(async () => {
      const tamperingFetch = signedFetchFactory({ fetch: createTamperingFetch(DELIVERED_METADATA) })

      response = await tamperingFetch(`${baseUrl}/identities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity }),
        identity,
        metadata: SIGNED_METADATA
      })
    })

    it('should reject the request rather than let it past the scene gate', async () => {
      const responseBody = await response.json()

      // `rejectIfSigner` refuses a non-canonical `signer` rather than comparing it, so the mixed-case
      // spelling cannot read as "not a scene" and slip past the gate. It fails there first; without
      // the guard the request would still be refused, but as a 401, because the delivered metadata
      // bytes are no longer the ones that were signed.
      expect(response.status).toBe(400)
      // The raw metadata is echoed back truncated at 64 characters, so match the prefix.
      expect(responseBody.error).toMatch(/^Invalid metadata content: /)
    })
  })

  describe('and the canonical signer is delivered exactly as signed', () => {
    let response: Response

    beforeEach(async () => {
      response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity },
        identity,
        metadata: SIGNED_METADATA
      })
    })

    it('should reject it as a scene request', async () => {
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.error).toMatch(/^Invalid metadata content: /)
    })
  })

  describe('and the request carries no signer at all', () => {
    let response: Response

    beforeEach(async () => {
      response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity },
        identity
      })
    })

    it('should authenticate normally and reach the handler', async () => {
      const responseBody = await response.json()

      // Ordinary user traffic must be untouched by the guard: this gets all the way to the
      // handler, which stores the identity and returns its id.
      expect(response.status).toBe(201)
      expect(responseBody).toHaveProperty('identityId')
    })
  })
})
