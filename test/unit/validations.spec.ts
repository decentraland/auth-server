import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import {
  RequestMessage,
  RecoverMessage,
  OutcomeMessage,
  RequestValidationMessage,
  HttpOutcomeMessage,
  IdentityRequest
} from '../../src/ports/server/types'
import {
  validateRequestMessage,
  validateRecoverMessage,
  validateOutcomeMessage,
  validateRequestValidationMessage,
  validateIdentityId,
  validateHttpOutcomeMessage,
  validateIdentityRequest
} from '../../src/ports/server/validations'
import { generateRandomIdentityId, createTestIdentity } from '../utils/test-identity'

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

describe('when validating identity requests', () => {
  let validIdentityRequest: unknown

  beforeEach(async () => {
    const testIdentity = await createTestIdentity()

    // Convert Date to ISO string as expected by the schema
    const identityWithStringExpiration = {
      ...testIdentity,
      expiration: testIdentity.expiration.toISOString()
    }

    validIdentityRequest = {
      identity: identityWithStringExpiration
    }
  })

  it('should return the validated message', () => {
    const result = validateIdentityRequest(validIdentityRequest)
    expect(result).toEqual(validIdentityRequest)
    expect(result.identity).toBeDefined()
    expect(result.identity.expiration).toBeDefined()
    expect(result.identity.ephemeralIdentity).toBeDefined()
    expect(result.identity.authChain).toBeDefined()
  })

  describe('and the message is missing identity field', () => {
    let invalidIdentityRequest: unknown

    beforeEach(() => {
      invalidIdentityRequest = {
        // Missing required 'identity' field
        expiration: new Date().toISOString()
      }
    })

    it('should throw validation error', () => {
      expect(() => validateIdentityRequest(invalidIdentityRequest)).toThrow()
    })
  })

  describe('and the message has invalid identity structure', () => {
    let invalidIdentityRequestInvalidIdentity: unknown

    beforeEach(() => {
      invalidIdentityRequestInvalidIdentity = {
        identity: {
          // Invalid identity structure
          expiration: 'invalid-date',
          ephemeralIdentity: {
            address: 'invalid-address',
            privateKey: 'invalid-key',
            publicKey: 'invalid-public-key'
          },
          authChain: []
        } as unknown as IdentityRequest['identity']
      }
    })

    it('should throw validation error', () => {
      expect(() => validateIdentityRequest(invalidIdentityRequestInvalidIdentity)).toThrow()
    })
  })

  describe('and the message is undefined', () => {
    it('should throw validation error', () => {
      expect(() => validateIdentityRequest(undefined)).toThrow()
    })
  })

  describe('and the message is not an object', () => {
    it('should throw validation error', () => {
      expect(() => validateIdentityRequest('invalid-string')).toThrow()
      expect(() => validateIdentityRequest(123)).toThrow()
      expect(() => validateIdentityRequest([])).toThrow()
    })
  })
})
