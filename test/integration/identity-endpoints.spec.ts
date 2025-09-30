import { AuthIdentity } from '@dcl/crypto'
import { test } from '../components'
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

      beforeEach(async () => {
        // Create valid auth identity using test utility
        const testIdentity = await createTestIdentity()
        validAuthIdentity = testIdentity.authChain
        validRequestData = { identity: validAuthIdentity }
      })

      it('should respond with 201 status and return identityId and expiration', async () => {
        const response = await fetch(`${baseUrl}/identities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(validRequestData)
        })

        expect(response.status).toBe(201)

        const responseBody = await response.json()
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
        const response = await fetch(`${baseUrl}/identities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emptyRequestData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('AuthIdentity is required in request body')
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
        const response = await fetch(`${baseUrl}/identities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invalidRequestData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
      })
    })

    describe('and the identity has expired', () => {
      let expiredRequestData: { identity: AuthIdentity }
      let expiredAuthIdentity: AuthIdentity

      beforeEach(async () => {
        // Create expired auth identity using test utility with negative expiration
        const testIdentity = await createTestIdentity(-1) // -1 minute (expired)
        expiredAuthIdentity = testIdentity.authChain
        expiredRequestData = { identity: expiredAuthIdentity }
      })

      it('should respond with 400 status and expiration error', async () => {
        const response = await fetch(`${baseUrl}/identities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(expiredRequestData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Ephemeral payload has expired')
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
      validAuthIdentity = testIdentity.authChain

      // Create a valid identity first
      requestData = { identity: validAuthIdentity }
      const response = await fetch(`${baseUrl}/identities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
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
        expect(responseBody).toHaveProperty('valid')
        expect(responseBody.valid).toBe(true)

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
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Invalid identity format')
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
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Identity not found')
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
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Identity not found')
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
