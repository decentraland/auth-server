import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import {
  RequestMessage,
  RecoverMessage,
  OutcomeMessage,
  RequestValidationMessage,
  IdentityIdRequest,
  HttpOutcomeMessage
} from '../../src/ports/server/types'
import {
  validateRequestMessage,
  validateRecoverMessage,
  validateOutcomeMessage,
  validateRequestValidationMessage,
  validateIdentityIdRequest,
  validateIdentityId,
  validateHttpOutcomeMessage
} from '../../src/ports/server/validations'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

describe('when testing validation functions', () => {
  describe('when validating request messages', () => {
    let validRequestMessage: RequestMessage
    let invalidRequestMessage: Partial<RequestMessage>

    beforeEach(() => {
      validRequestMessage = {
        method: 'eth_sendTransaction',
        params: [{ from: '0x123', to: '0x456', value: '0x1' }]
      }

      invalidRequestMessage = {
        // Missing required 'method' field
        params: []
      }
    })

    describe('and the message is valid', () => {
      it('should return the validated message', () => {
        const result = validateRequestMessage(validRequestMessage)
        expect(result).toEqual(validRequestMessage)
        expect(result.method).toBe('eth_sendTransaction')
        expect(result.params).toHaveLength(1)
      })
    })

    describe('and the message is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateRequestMessage(invalidRequestMessage)).toThrow()
      })
    })
  })

  describe('when validating recover messages', () => {
    let validRecoverMessage: RecoverMessage
    let invalidRecoverMessage: Partial<RecoverMessage>

    beforeEach(() => {
      validRecoverMessage = {
        requestId: generateRandomIdentityId()
      }

      invalidRecoverMessage = {
        // Missing required 'requestId' field
      }
    })

    describe('and the message is valid', () => {
      it('should return the validated message', () => {
        const result = validateRecoverMessage(validRecoverMessage)
        expect(result).toEqual(validRecoverMessage)
        expect(result.requestId).toBe(validRecoverMessage.requestId)
      })
    })

    describe('and the message is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateRecoverMessage(invalidRecoverMessage)).toThrow()
      })
    })
  })

  describe('when validating outcome messages', () => {
    let validOutcomeMessageWithResult: OutcomeMessage
    let validOutcomeMessageWithError: OutcomeMessage
    let invalidOutcomeMessage: Partial<OutcomeMessage>
    let requestId: string
    let sender: string

    beforeEach(() => {
      requestId = generateRandomIdentityId()
      sender = createUnsafeIdentity().address
      validOutcomeMessageWithResult = {
        requestId,
        sender,
        result: { transactionHash: '0xabcdef' }
      }

      validOutcomeMessageWithError = {
        requestId,
        sender,
        error: {
          code: 1233,
          message: 'Transaction failed'
        }
      }

      invalidOutcomeMessage = {
        requestId,
        sender
        // Missing required 'result' or 'error' field
      }
    })

    describe('and the message has valid result', () => {
      it('should return the validated message', () => {
        const result = validateOutcomeMessage(validOutcomeMessageWithResult)
        expect(result).toEqual(validOutcomeMessageWithResult)
        expect(result.result).toEqual({ transactionHash: '0xabcdef' })
      })
    })

    describe('and the message has valid error', () => {
      it('should return the validated message', () => {
        const result = validateOutcomeMessage(validOutcomeMessageWithError)
        expect(result).toEqual(validOutcomeMessageWithError)
        expect(result.error).toEqual({
          code: 1233,
          message: 'Transaction failed'
        })
      })
    })

    describe('and the message is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateOutcomeMessage(invalidOutcomeMessage)).toThrow()
      })
    })
  })

  describe('when validating request validation messages', () => {
    let validRequestValidationMessage: RequestValidationMessage
    let invalidRequestValidationMessage: Partial<RequestValidationMessage>

    beforeEach(() => {
      validRequestValidationMessage = {
        requestId: generateRandomIdentityId()
      }

      invalidRequestValidationMessage = {
        // Missing required 'requestId' field
      }
    })

    describe('and the message is valid', () => {
      it('should return the validated message', () => {
        const result = validateRequestValidationMessage(validRequestValidationMessage)
        expect(result).toEqual(validRequestValidationMessage)
        expect(result.requestId).toBe(validRequestValidationMessage.requestId)
      })
    })

    describe('and the message is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateRequestValidationMessage(invalidRequestValidationMessage)).toThrow()
      })
    })
  })

  describe('when validating identity ID requests', () => {
    let validIdentityIdRequest: IdentityIdRequest
    let invalidIdentityIdRequest: Partial<IdentityIdRequest>

    beforeEach(async () => {
      const testIdentity = await createTestIdentity()

      validIdentityIdRequest = {
        identity: testIdentity.authChain
      }

      invalidIdentityIdRequest = {
        // Missing required 'identity' field
      }
    })

    describe('and the request is valid', () => {
      it('should return the validated request', () => {
        // Convert Date to ISO string for validation
        const validationInput = {
          identity: {
            ...validIdentityIdRequest.identity,
            expiration: validIdentityIdRequest.identity.expiration.toISOString()
          }
        }
        const result = validateIdentityIdRequest(validationInput)
        expect(result).toEqual(validationInput)
        expect(result.identity).toHaveProperty('expiration')
        expect(result.identity).toHaveProperty('ephemeralIdentity')
        expect(result.identity).toHaveProperty('authChain')
      })
    })

    describe('and the request is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateIdentityIdRequest(invalidIdentityIdRequest)).toThrow()
      })
    })
  })

  describe('when validating identity IDs', () => {
    let validIdentityId: string
    let invalidIdentityId: string
    let emptyIdentityId: string

    beforeEach(() => {
      validIdentityId = generateRandomIdentityId()
      invalidIdentityId = 'invalid-uuid-format'
      emptyIdentityId = ''
    })

    describe('and the identity ID is valid UUID v4', () => {
      it('should return true', () => {
        const result = validateIdentityId(validIdentityId)
        expect(result).toBe(true)
      })
    })

    describe('and the identity ID has invalid format', () => {
      it('should return false', () => {
        const result = validateIdentityId(invalidIdentityId)
        expect(result).toBe(false)
      })
    })

    describe('and the identity ID is empty', () => {
      it('should return false', () => {
        const result = validateIdentityId(emptyIdentityId)
        expect(result).toBe(false)
      })
    })

    describe('and the identity ID is null', () => {
      it('should return false', () => {
        const result = validateIdentityId(null as unknown as string)
        expect(result).toBe(false)
      })
    })

    describe('and the identity ID is not a string', () => {
      it('should return false', () => {
        const result = validateIdentityId(123 as unknown as string)
        expect(result).toBe(false)
      })
    })
  })

  describe('when validating HTTP outcome messages', () => {
    let validHttpOutcomeMessage: HttpOutcomeMessage
    let invalidHttpOutcomeMessage: Partial<HttpOutcomeMessage>
    let sender: string

    beforeEach(() => {
      sender = createUnsafeIdentity().address

      validHttpOutcomeMessage = {
        sender,
        result: { transactionHash: '0xabcdef' }
      }

      invalidHttpOutcomeMessage = {
        // Missing required 'sender' field
        result: { transactionHash: '0xabcdef' }
      }
    })

    describe('and the message is valid', () => {
      it('should return the validated message', () => {
        const result = validateHttpOutcomeMessage(validHttpOutcomeMessage)
        expect(result).toEqual(validHttpOutcomeMessage)
        expect(result.sender).toBe(sender)
        expect(result.result).toEqual({ transactionHash: '0xabcdef' })
      })
    })

    describe('and the message is invalid', () => {
      it('should throw validation error', () => {
        expect(() => validateHttpOutcomeMessage(invalidHttpOutcomeMessage)).toThrow()
      })
    })
  })
})
