import { AuthIdentity } from '@dcl/crypto'
import { test, testWithOverrides } from '../components'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const AUTH_REQUEST_ID = '13d31e96-1a1a-48ec-af16-b10c4c982e08'

test('when testing identity endpoints', args => {
  let port: string
  let baseUrl: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  describe('and creating an identity', () => {
    describe('and the request body is valid', () => {
      let validRequestData: { identity: AuthIdentity }
      let testIdentity: AuthIdentity

      beforeEach(async () => {
        // Create valid auth identity using test utility
        testIdentity = await createTestIdentity()
        validRequestData = { identity: testIdentity }
      })

      it('should respond with 201 status and return identityId and expiration', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: validRequestData,
          identity: testIdentity
        })
        expect(response.status).toBe(201)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('expiration')
        expect(responseBody.identityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      })
    })

    describe('and the identity is missing from request body', () => {
      let emptyRequestData: Record<string, never>

      beforeEach(() => {
        emptyRequestData = {}
      })

      it('should respond with 400 status and error message', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: emptyRequestData
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toEqual({
          error: 'Invalid Auth Chain',
          message: 'This endpoint requires a signed fetch request. See ADR-44.'
        })
      })
    })

    describe('and the identity has invalid format', () => {
      let invalidRequestData: { identity: Partial<AuthIdentity> }
      let invalidAuthIdentity: Partial<AuthIdentity>

      beforeEach(() => {
        // Create invalid auth identity
        invalidAuthIdentity = {
          expiration: new Date('invalid-date'),
          ephemeralIdentity: {
            address: 'invalid-address',
            privateKey: '',
            publicKey: ''
          },
          authChain: []
        }

        invalidRequestData = { identity: invalidAuthIdentity }
      })

      it('should respond with 400 status and validation error', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: invalidRequestData
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(typeof responseBody.error).toBe('string')
        expect(responseBody.error.length).toBeGreaterThan(0)
      })
    })

    describe('and the identity has expired', () => {
      let expiredRequestData: { identity: AuthIdentity }
      let expiredTestIdentity: AuthIdentity

      beforeEach(async () => {
        // Create expired auth identity using test utility with negative expiration
        expiredTestIdentity = await createTestIdentity(-1) // -1 minute (expired)
        expiredRequestData = { identity: expiredTestIdentity }
      })

      it('should respond with 401 status and Ephemeral key expired error', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: expiredRequestData,
          identity: expiredTestIdentity
        })

        expect(response.status).toBe(401)

        const responseBody = await response.json()
        expect(responseBody.error).toContain('Ephemeral key expired')
      })
    })

    describe('and the ephemeral private key does not match the address', () => {
      let invalidPrivateKeyRequestData: { identity: AuthIdentity }
      let testIdentityWithInvalidPrivateKey: AuthIdentity
      let validTestIdentity: AuthIdentity

      beforeEach(async () => {
        validTestIdentity = await createTestIdentity()

        const { ethers } = await import('ethers')
        const newWallet = ethers.Wallet.createRandom()

        // Modify the identity to have a different private key but keep the same address
        testIdentityWithInvalidPrivateKey = {
          ...validTestIdentity,
          ephemeralIdentity: {
            ...validTestIdentity.ephemeralIdentity,
            privateKey: newWallet.privateKey
          }
        }

        invalidPrivateKeyRequestData = { identity: testIdentityWithInvalidPrivateKey }
      })

      it('should respond with 403 status and private key mismatch error', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: invalidPrivateKeyRequestData,
          identity: validTestIdentity
        })

        expect(response.status).toBe(403)

        const responseBody = await response.json()
        expect(responseBody).toEqual({
          error: 'Ephemeral private key does not match the provided address'
        })
      })
    })
  })

  describe('and creating an identity with an authRequestId that is not a UUID v4', () => {
    let response: Response

    beforeEach(async () => {
      const testIdentity = await createTestIdentity()
      response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: { identity: testIdentity, authRequestId: 'not-a-uuid' },
        identity: testIdentity
      })
    })

    it('should respond with a 400 status', () => {
      expect(response.status).toBe(400)
    })
  })

  describe('and retrieving an identity', () => {
    let identityId: string
    let requestData: { identity: AuthIdentity }
    let testIdentity: AuthIdentity

    beforeEach(async () => {
      // Create valid auth identity using test utility
      testIdentity = await createTestIdentity()

      // Create a valid identity first
      requestData = { identity: testIdentity }
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: requestData,
        identity: testIdentity
      })

      const responseBody = await response.json()
      identityId = responseBody.identityId
    })

    describe('and the identityId is valid', () => {
      it('should respond with 200 status and return the identity', async () => {
        const response = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET'
        })

        expect(response.status).toBe(200)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('identity')

        // Convert expiration to string for comparison since API returns it as string
        const expectedIdentity = {
          ...testIdentity,
          expiration: testIdentity.expiration.toISOString()
        }
        expect(responseBody.identity).toEqual(expectedIdentity)
      })
    })

    describe('and the identityId has invalid format', () => {
      let invalidIdentityId: string

      beforeEach(() => {
        invalidIdentityId = 'invalid-format'
      })

      it('should respond with 400 status and format error', async () => {
        const response = await fetch(`${baseUrl}/identities/${invalidIdentityId}`, {
          method: 'GET'
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toEqual({
          error: 'Invalid identity format'
        })
      })
    })

    describe('and the identityId does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should respond with 404 status and not found error', async () => {
        const response = await fetch(`${baseUrl}/identities/${nonExistentId}`, {
          method: 'GET'
        })

        expect(response.status).toBe(404)

        const responseBody = await response.json()
        expect(responseBody).toEqual({
          error: 'Identity not found'
        })
      })
    })

    describe('and the identity has been consumed', () => {
      it('should respond with 404 status on second request', async () => {
        // First request should succeed
        const firstResponse = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET'
        })
        expect(firstResponse.status).toBe(200)

        // Second request should fail because identity was consumed
        const secondResponse = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET'
        })
        expect(secondResponse.status).toBe(404)

        const responseBody = await secondResponse.json()
        expect(responseBody).toEqual({
          error: 'Identity was already consumed'
        })
      })
    })

    describe('and the identity is requested from a different IP', () => {
      let response: Response
      let responseBody: { identity: AuthIdentity }

      beforeEach(async () => {
        response = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET',
          headers: {
            'CF-Connecting-IP': '2001:db8::1'
          }
        })
        responseBody = await response.json()
      })

      it('should respond with a 200 status', () => {
        expect(response.status).toBe(200)
      })

      it('should return the identity', () => {
        expect(responseBody).toHaveProperty('identity')
      })
    })

    describe('and the identity has been consumed and is requested from a different IP', () => {
      it('should still respond with 404 and consumed message', async () => {
        // First request consumes the identity
        const firstResponse = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET'
        })
        expect(firstResponse.status).toBe(200)

        // Second request from a different IP should indicate it was consumed, not IP mismatch
        const secondResponse = await fetch(`${baseUrl}/identities/${identityId}`, {
          method: 'GET',
          headers: {
            'CF-Connecting-IP': '10.0.0.1'
          }
        })
        expect(secondResponse.status).toBe(404)

        const responseBody = await secondResponse.json()
        expect(responseBody).toEqual({
          error: 'Identity was already consumed'
        })
      })
    })

    describe('and the identityId never existed and is requested multiple times', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should consistently respond with identity not found', async () => {
        const firstResponse = await fetch(`${baseUrl}/identities/${nonExistentId}`, {
          method: 'GET'
        })
        expect(firstResponse.status).toBe(404)
        const firstBody = await firstResponse.json()
        expect(firstBody).toEqual({ error: 'Identity not found' })

        const secondResponse = await fetch(`${baseUrl}/identities/${nonExistentId}`, {
          method: 'GET'
        })
        expect(secondResponse.status).toBe(404)
        const secondBody = await secondResponse.json()
        expect(secondBody).toEqual({ error: 'Identity not found' })
      })
    })

    describe('and the identity was evicted by Redis TTL', () => {
      let getIdentitySpy: jest.SpyInstance
      let response: Response
      let responseBody: { error: string; createdAt: string }

      beforeEach(async () => {
        // Spy on getIdentity to return null, simulating Redis TTL eviction. The tombstone
        // (identity status) is still in Redis because it has a longer TTL.
        getIdentitySpy = jest.spyOn(args.components.storage, 'getIdentity').mockResolvedValueOnce(null)

        response = await fetch(`${baseUrl}/identities/${identityId}`, { method: 'GET' })
        responseBody = await response.json()
      })

      afterEach(() => {
        // resetMocks clears mock state but does not restore a spy's original implementation.
        getIdentitySpy.mockRestore()
      })

      it('should respond with a 404 status code', () => {
        expect(response.status).toBe(404)
      })

      it('should respond with an evicted error message', () => {
        expect(responseBody.error).toBe('Identity was evicted')
      })

      it('should include a valid createdAt timestamp of the evicted identity', () => {
        expect(responseBody).toHaveProperty('createdAt')
        expect(new Date(responseBody.createdAt).getTime()).not.toBeNaN()
      })
    })

    describe('and the identity was created with an authRequestId', () => {
      let verifiedTestIdentity: AuthIdentity
      let verifiedIdentityId: string

      beforeEach(async () => {
        verifiedTestIdentity = await createTestIdentity()
        const createResponse = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: { identity: verifiedTestIdentity, authRequestId: AUTH_REQUEST_ID },
          identity: verifiedTestIdentity,
          headers: {
            'X-Real-IP': '2001:db8:1:2::1'
          }
        })
        verifiedIdentityId = (await createResponse.json()).identityId
      })

      describe('and the request carries the matching verifier from an IPv4 address', () => {
        let response: Response
        let responseBody: { identity: AuthIdentity }

        beforeEach(async () => {
          response = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '203.0.113.7',
              'x-identity-verifier': VERIFIER
            }
          })
          responseBody = await response.json()
        })

        it('should respond with a 200 status', () => {
          expect(response.status).toBe(200)
        })

        it('should return the stored identity', () => {
          expect(responseBody.identity).toEqual({
            ...verifiedTestIdentity,
            expiration: verifiedTestIdentity.expiration.toISOString()
          })
        })
      })

      describe('and the request carries a wrong verifier', () => {
        let response: Response
        let responseBody: { error: string }
        let retryResponse: Response

        beforeEach(async () => {
          response = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '2001:db8:1:2::1',
              'x-identity-verifier': `${VERIFIER.slice(0, 42)}A`
            }
          })
          responseBody = await response.json()
          retryResponse = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '203.0.113.7',
              'x-identity-verifier': VERIFIER
            }
          })
        })

        it('should respond with a 401 status and an invalid verifier error', () => {
          expect({ status: response.status, body: responseBody }).toEqual({
            status: 401,
            body: { error: 'Invalid identity verifier' }
          })
        })

        it('should keep the identity so the matching verifier can still retrieve it', () => {
          expect(retryResponse.status).toBe(200)
        })
      })

      describe('and the request carries a malformed verifier', () => {
        let response: Response
        let responseBody: { error: string }
        let retryResponse: Response

        beforeEach(async () => {
          response = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '2001:db8:1:2::1',
              'x-identity-verifier': VERIFIER.slice(0, 42)
            }
          })
          responseBody = await response.json()
          retryResponse = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '203.0.113.7',
              'x-identity-verifier': VERIFIER
            }
          })
        })

        it('should respond with a 401 status and an invalid verifier error', () => {
          expect({ status: response.status, body: responseBody }).toEqual({
            status: 401,
            body: { error: 'Invalid identity verifier' }
          })
        })

        it('should keep the identity so the matching verifier can still retrieve it', () => {
          expect(retryResponse.status).toBe(200)
        })
      })

      describe('and the request carries no verifier from a different IP', () => {
        let response: Response

        beforeEach(async () => {
          response = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
            method: 'GET',
            headers: {
              'X-Real-IP': '203.0.113.7'
            }
          })
        })

        it('should respond with a 200 status while the verifier is not required', () => {
          expect(response.status).toBe(200)
        })
      })
    })

    describe('and the identity was created without an authRequestId and the request carries a verifier from a different IP', () => {
      let response: Response

      beforeEach(async () => {
        const unboundTestIdentity = await createTestIdentity()
        const createResponse = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: { identity: unboundTestIdentity },
          identity: unboundTestIdentity,
          headers: {
            'X-Real-IP': '10.0.0.1'
          }
        })
        const { identityId: unboundIdentityId } = await createResponse.json()

        response = await fetch(`${baseUrl}/identities/${unboundIdentityId}`, {
          method: 'GET',
          headers: {
            'X-Real-IP': '203.0.113.7',
            'x-identity-verifier': VERIFIER
          }
        })
      })

      it('should ignore the verifier and respond with a 200 status', () => {
        expect(response.status).toBe(200)
      })
    })
  })
})

testWithOverrides({ requireIdentityVerifier: true })('when retrieving an identity while the verifier is required', args => {
  let baseUrl: string
  let verifiedIdentityId: string

  beforeEach(async () => {
    baseUrl = `http://localhost:${await args.components.config.requireString('HTTP_SERVER_PORT')}`
    const verifiedTestIdentity = await createTestIdentity()
    const createResponse = await createSignedFetchRequest(baseUrl, {
      method: 'POST',
      path: '/identities',
      body: { identity: verifiedTestIdentity, authRequestId: AUTH_REQUEST_ID },
      identity: verifiedTestIdentity,
      headers: {
        'X-Real-IP': '2001:db8:1:2::1'
      }
    })
    verifiedIdentityId = (await createResponse.json()).identityId
  })

  describe('and the request carries no verifier', () => {
    let response: Response
    let responseBody: { error: string }
    let retryResponse: Response

    beforeEach(async () => {
      response = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
        method: 'GET',
        headers: {
          'X-Real-IP': '2001:db8:1:2::1'
        }
      })
      responseBody = await response.json()
      retryResponse = await fetch(`${baseUrl}/identities/${verifiedIdentityId}`, {
        method: 'GET',
        headers: {
          'X-Real-IP': '203.0.113.7',
          'x-identity-verifier': VERIFIER
        }
      })
    })

    it('should respond with a 401 status and an invalid verifier error', () => {
      expect({ status: response.status, body: responseBody }).toEqual({
        status: 401,
        body: { error: 'Invalid identity verifier' }
      })
    })

    it('should keep the identity so the matching verifier can still retrieve it', () => {
      expect(retryResponse.status).toBe(200)
    })
  })
})
