import { AuthIdentity, IdentityType } from '@dcl/crypto'
import { test } from '../components'
import { createSignedFetchRequest } from '../utils/signed-request'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

test('when testing identity endpoints', args => {
  let port: string
  let baseUrl: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  describe('when creating an identity', () => {
    describe('and the request body is valid', () => {
      let validRequestData: { identity: AuthIdentity }
      let validAuthIdentity: AuthIdentity
      let testIdentity: { authIdentity: AuthIdentity; realAccount: IdentityType; ephemeralIdentity: IdentityType }

      beforeEach(async () => {
        // Create valid auth identity using test utility
        testIdentity = await createTestIdentity()
        validAuthIdentity = testIdentity.authIdentity
        validRequestData = { identity: validAuthIdentity }
      })

      it('should respond with 201 status and return identityId and expiration', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: validRequestData,
          identity: validAuthIdentity
        })
        const responseBody = await response.json()
        console.log('responseBody', responseBody)
        expect(response.status).toBe(201)

        expect(responseBody).toHaveProperty('identityId')
        expect(responseBody).toHaveProperty('expiration')
        expect(typeof responseBody.identityId).toBe('string')
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
      let expiredAuthIdentity: AuthIdentity
      let expiredTestIdentity: any

      beforeEach(async () => {
        // Create expired auth identity using test utility with negative expiration
        expiredTestIdentity = await createTestIdentity(-1) // -1 minute (expired)
        expiredAuthIdentity = expiredTestIdentity.authChain
        expiredRequestData = { identity: expiredAuthIdentity }
      })

      it('should respond with 400 status and Invalid Auth Chain error', async () => {
        const response = await createSignedFetchRequest(baseUrl, {
          method: 'POST',
          path: '/identities',
          body: expiredRequestData,
          identity: expiredAuthIdentity
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody.error).toContain('Invalid Auth Chain')
      })
    })
  })

  describe('when retrieving an identity', () => {
    let identityId: string
    let requestData: { identity: AuthIdentity }
    let validAuthIdentity: AuthIdentity

    beforeEach(async () => {
      // Create valid auth identity using test utility
      const testIdentity = await createTestIdentity()
      validAuthIdentity = testIdentity.authIdentity

      // Create a valid identity first
      requestData = { identity: validAuthIdentity }
      const response = await createSignedFetchRequest(baseUrl, {
        method: 'POST',
        path: '/identities',
        body: requestData,
        identity: validAuthIdentity
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
          ...validAuthIdentity,
          expiration: validAuthIdentity.expiration.toISOString()
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
          error: 'Identity not found'
        })
      })
    })
  })
})

test('when testing health endpoints', args => {
  let port: string
  let baseUrl: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  describe('when checking health ready', () => {
    it('should respond with 200 status', async () => {
      const response = await fetch(`${baseUrl}/health/ready`, {
        method: 'GET'
      })

      expect(response.status).toBe(200)
    })
  })

  describe('when checking health startup', () => {
    it('should respond with 200 status', async () => {
      const response = await fetch(`${baseUrl}/health/startup`, {
        method: 'GET'
      })

      expect(response.status).toBe(200)
    })
  })

  describe('when checking health live', () => {
    it('should respond with 200 status and timestamp', async () => {
      const response = await fetch(`${baseUrl}/health/live`, {
        method: 'GET'
      })

      expect(response.status).toBe(200)

      const responseBody = await response.json()
      expect(responseBody).toHaveProperty('timestamp')
      expect(typeof responseBody.timestamp).toBe('number')
    })
  })
})
