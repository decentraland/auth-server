import { AuthChain, Authenticator, AuthLinkType } from '@dcl/crypto'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { RequestMessage, OutcomeMessage } from '../../src/ports/server/types'
import { test } from '../components'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

test('when testing request endpoints', args => {
  let port: string
  let baseUrl: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  describe('when creating a request', () => {
    describe('and the request is valid', () => {
      let validRequestData: RequestMessage
      let validAuthChain: AuthChain

      beforeEach(async () => {
        // Create valid auth chain using test utility
        const testIdentity = await createTestIdentity()
        validAuthChain = testIdentity.authChain.authChain

        validRequestData = {
          method: METHOD_DCL_PERSONAL_SIGN,
          params: [],
          authChain: validAuthChain
        }
      })

      it('should respond with 201 status and return requestId', async () => {
        const response = await fetch(`${baseUrl}/requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(validRequestData)
        })

        expect(response.status).toBe(201)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('requestId')
        expect(responseBody).toHaveProperty('expiration')
        expect(responseBody).toHaveProperty('code')
        expect(typeof responseBody.requestId).toBe('string')
        expect(typeof responseBody.code).toBe('number')
      })
    })

    describe('and the request has invalid schema', () => {
      let invalidRequestData: Partial<RequestMessage>

      beforeEach(() => {
        invalidRequestData = {
          // Missing required 'method' field
          params: []
        }
      })

      it('should respond with 400 status and validation error', async () => {
        const response = await fetch(`${baseUrl}/requests`, {
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

    describe('and the auth chain is invalid', () => {
      let invalidAuthChainRequestData: RequestMessage
      let invalidAuthChain: AuthChain

      beforeEach(() => {
        // Create invalid auth chain
        invalidAuthChain = [
          {
            type: AuthLinkType.SIGNER,
            payload: 'invalid-address',
            signature: ''
          }
        ]

        invalidAuthChainRequestData = {
          method: 'eth_sendTransaction',
          params: [{ from: '0x123', to: '0x456', value: '0x1' }],
          authChain: invalidAuthChain
        }
      })

      it('should respond with 400 status and auth chain error', async () => {
        const response = await fetch(`${baseUrl}/requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invalidAuthChainRequestData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Could not get final authority from auth chain')
      })
    })

    describe('and the auth chain has expired', () => {
      let expiredAuthChainRequestData: RequestMessage
      let expiredAuthChain: AuthChain

      beforeEach(async () => {
        // Create expired auth chain using test utility
        const testIdentity = await createTestIdentity()
        // Override expiration to make it expired
        expiredAuthChain = [
          {
            type: AuthLinkType.SIGNER,
            payload: testIdentity.authChain.authChain[0].payload,
            signature: ''
          },
          {
            type: AuthLinkType.ECDSA_PERSONAL_EPHEMERAL,
            payload: Authenticator.getEphemeralMessage(
              testIdentity.authChain.ephemeralIdentity.address,
              new Date(Date.now() - 60000) // 1 minute ago
            ),
            signature: testIdentity.authChain.authChain[1].signature
          }
        ]

        expiredAuthChainRequestData = {
          method: 'eth_sendTransaction',
          params: [{ from: '0x123', to: '0x456', value: '0x1' }],
          authChain: expiredAuthChain
        }
      })

      it('should respond with 400 status and expiration error', async () => {
        const response = await fetch(`${baseUrl}/requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(expiredAuthChainRequestData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe('Ephemeral payload has expired')
      })
    })
  })

  describe('when retrieving a request', () => {
    let requestId: string
    let requestData: RequestMessage
    let validAuthChain: AuthChain

    beforeEach(async () => {
      // Create valid auth chain using test utility
      const testIdentity = await createTestIdentity()
      validAuthChain = testIdentity.authChain.authChain

      // Create a valid request first
      requestData = {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: [],
        authChain: validAuthChain
      }

      const response = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      const responseBody = await response.json()
      requestId = responseBody.requestId
    })

    describe('and the requestId is valid', () => {
      it('should respond with 200 status and return the request', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}`, {
          method: 'GET'
        })

        expect(response.status).toBe(200)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('expiration')
        expect(responseBody).toHaveProperty('code')
        expect(responseBody).toHaveProperty('method')
        expect(responseBody).toHaveProperty('params')
        expect(responseBody.method).toBe(METHOD_DCL_PERSONAL_SIGN)
      })
    })

    describe('and the requestId does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should respond with 404 status and not found error', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${nonExistentId}`, {
          method: 'GET'
        })

        expect(response.status).toBe(404)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toContain('Request with id')
        expect(responseBody.error).toContain('not found')
      })
    })
  })

  describe('when submitting request validation', () => {
    let requestId: string
    let requestData: RequestMessage
    let validAuthChain: AuthChain

    beforeEach(async () => {
      // Create valid auth chain using test utility
      const testIdentity = await createTestIdentity()
      validAuthChain = testIdentity.authChain.authChain

      // Create a valid request first
      requestData = {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: [],
        authChain: validAuthChain
      }

      const response = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      const responseBody = await response.json()
      requestId = responseBody.requestId
    })

    describe('and the requestId is valid', () => {
      let validationData: { requestId: string }

      beforeEach(() => {
        validationData = {
          requestId
        }
      })

      it('should respond with 204 status', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}/validation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(validationData)
        })

        expect(response.status).toBe(204)
      })
    })

    describe('and the requestId does not exist', () => {
      let nonExistentId: string
      let validationData: { requestId: string }

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
        validationData = {
          requestId: nonExistentId
        }
      })

      it('should respond with 404 status and not found error', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${nonExistentId}/validation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(validationData)
        })

        expect(response.status).toBe(404)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe(`Request with id "${nonExistentId}" not found`)
      })
    })
  })

  describe('when getting request validation status', () => {
    let requestId: string
    let requestData: RequestMessage
    let validAuthChain: AuthChain

    beforeEach(async () => {
      // Create valid auth chain using test utility
      const testIdentity = await createTestIdentity()
      validAuthChain = testIdentity.authChain.authChain

      // Create a valid request first
      requestData = {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: [],
        authChain: validAuthChain
      }

      const response = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      const responseBody = await response.json()
      requestId = responseBody.requestId
    })

    describe('and the requestId is valid', () => {
      it('should respond with 200 status and return validation status', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}/validation`, {
          method: 'GET'
        })

        expect(response.status).toBe(200)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('requiresValidation')
        expect(typeof responseBody.requiresValidation).toBe('boolean')
      })
    })

    describe('and the requestId does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should respond with 404 status and not found error', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${nonExistentId}/validation`, {
          method: 'GET'
        })

        expect(response.status).toBe(404)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe(`Request with id "${nonExistentId}" not found`)
      })
    })
  })

  describe('when submitting request outcome', () => {
    let requestId: string
    let requestData: RequestMessage
    let validAuthChain: AuthChain

    beforeEach(async () => {
      // Create valid auth chain using test utility
      const testIdentity = await createTestIdentity()
      validAuthChain = testIdentity.authChain.authChain

      // Create a valid request first
      requestData = {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: [],
        authChain: validAuthChain
      }

      const response = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      const responseBody = await response.json()
      requestId = responseBody.requestId
    })

    describe('and the outcome is valid', () => {
      let successfulOutcomeData: OutcomeMessage
      let failedOutcomeData: OutcomeMessage

      beforeEach(() => {
        successfulOutcomeData = {
          requestId,
          sender: '0x1234567890123456789012345678901234567890',
          result: {
            transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
          }
        }

        failedOutcomeData = {
          requestId,
          sender: '0x1234567890123456789012345678901234567890',
          error: {
            code: 1233,
            message: 'Transaction failed'
          }
        }
      })

      it('should respond with 200 status for successful outcome', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}/outcome`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(successfulOutcomeData)
        })

        expect(response.status).toBe(200)
      })

      it('should respond with 200 status for failed outcome', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}/outcome`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(failedOutcomeData)
        })

        expect(response.status).toBe(200)
      })
    })

    describe('and the requestId does not exist', () => {
      let nonExistentId: string
      let outcomeData: OutcomeMessage

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
        outcomeData = {
          requestId: nonExistentId,
          sender: '0x1234567890123456789012345678901234567890',
          result: { success: true }
        }
      })

      it('should respond with 404 status and not found error', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${nonExistentId}/outcome`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(outcomeData)
        })

        expect(response.status).toBe(404)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
        expect(responseBody.error).toBe(`Request with id "${nonExistentId}" not found`)
      })
    })

    describe('and the outcome has invalid schema', () => {
      let invalidOutcomeData: Partial<OutcomeMessage>

      beforeEach(() => {
        invalidOutcomeData = {
          requestId,
          sender: '0x1234567890123456789012345678901234567890'
          // Missing required 'result' or 'error' field
        }
      })

      it('should respond with 400 status and validation error', async () => {
        const response = await fetch(`${baseUrl}/v2/requests/${requestId}/outcome`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invalidOutcomeData)
        })

        expect(response.status).toBe(400)

        const responseBody = await response.json()
        expect(responseBody).toHaveProperty('error')
      })
    })
  })
})
