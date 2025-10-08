import { AuthIdentity } from '@dcl/crypto'
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

  describe('when retrieving an identity', () => {
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
          error: 'Identity not found'
        })
      })
    })
  })
})
