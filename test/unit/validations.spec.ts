import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { MAX_METHOD_LENGTH, MAX_PARAMS_ITEMS, MAX_ERROR_MESSAGE_LENGTH, MAX_REQUEST_ID_LENGTH } from '../../src/ports/server/constants'
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

  describe('and the method exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongMethod = {
        method: 'a'.repeat(MAX_METHOD_LENGTH + 1),
        params: []
      }
      expect(() => validateRequestMessage(messageWithLongMethod)).toThrow()
    })
  })

  describe('and the method is at max length', () => {
    it('should return the validated message', () => {
      const messageWithMaxMethod = {
        method: 'a'.repeat(MAX_METHOD_LENGTH),
        params: []
      }
      const result = validateRequestMessage(messageWithMaxMethod)
      expect(result.method).toHaveLength(MAX_METHOD_LENGTH)
    })
  })

  describe('and the params array exceeds max items', () => {
    it('should throw validation error', () => {
      const messageWithTooManyParams = {
        method: 'eth_call',
        params: Array(MAX_PARAMS_ITEMS + 1).fill({ data: 'test' })
      }
      expect(() => validateRequestMessage(messageWithTooManyParams)).toThrow()
    })
  })

  describe('and the params array is at max items', () => {
    it('should return the validated message', () => {
      const messageWithMaxParams = {
        method: 'eth_call',
        params: Array(MAX_PARAMS_ITEMS).fill({ data: 'test' })
      }
      const result = validateRequestMessage(messageWithMaxParams)
      expect(result.params).toHaveLength(MAX_PARAMS_ITEMS)
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

  describe('and the requestId exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1)
      }
      expect(() => validateRecoverMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the requestId is at max length', () => {
    it('should return the validated message', () => {
      const messageWithMaxRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH)
      }
      const result = validateRecoverMessage(messageWithMaxRequestId)
      expect(result.requestId).toHaveLength(MAX_REQUEST_ID_LENGTH)
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

  describe('and the requestId exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1),
        sender: '0x1234567890123456789012345678901234567890',
        result: { data: 'test' }
      }
      expect(() => validateOutcomeMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the sender is not a valid Ethereum address', () => {
    it('should throw validation error for invalid format', () => {
      const messageWithInvalidSender = {
        requestId: generateRandomIdentityId(),
        sender: 'invalid-sender-address',
        result: { data: 'test' }
      }
      expect(() => validateOutcomeMessage(messageWithInvalidSender)).toThrow()
    })

    it('should throw validation error for address without 0x prefix', () => {
      const messageWithoutPrefix = {
        requestId: generateRandomIdentityId(),
        sender: '1234567890123456789012345678901234567890',
        result: { data: 'test' }
      }
      expect(() => validateOutcomeMessage(messageWithoutPrefix)).toThrow()
    })

    it('should throw validation error for address with wrong length', () => {
      const messageWithShortAddress = {
        requestId: generateRandomIdentityId(),
        sender: '0x123456789012345678901234567890123456789', // 39 chars instead of 40
        result: { data: 'test' }
      }
      expect(() => validateOutcomeMessage(messageWithShortAddress)).toThrow()
    })

    it('should throw validation error for address with invalid characters', () => {
      const messageWithInvalidChars = {
        requestId: generateRandomIdentityId(),
        sender: '0xGGGG567890123456789012345678901234567890', // G is not hex
        result: { data: 'test' }
      }
      expect(() => validateOutcomeMessage(messageWithInvalidChars)).toThrow()
    })
  })

  describe('and the sender is a valid Ethereum address', () => {
    it('should return the validated message for lowercase address', () => {
      const messageWithLowercaseSender = {
        requestId: generateRandomIdentityId(),
        sender: '0xabcdef7890123456789012345678901234567890',
        result: { data: 'test' }
      }
      const result = validateOutcomeMessage(messageWithLowercaseSender)
      expect(result.sender).toBe('0xabcdef7890123456789012345678901234567890')
    })

    it('should return the validated message for uppercase address', () => {
      const messageWithUppercaseSender = {
        requestId: generateRandomIdentityId(),
        sender: '0xABCDEF7890123456789012345678901234567890',
        result: { data: 'test' }
      }
      const result = validateOutcomeMessage(messageWithUppercaseSender)
      expect(result.sender).toBe('0xABCDEF7890123456789012345678901234567890')
    })

    it('should return the validated message for mixed case address', () => {
      const messageWithMixedCaseSender = {
        requestId: generateRandomIdentityId(),
        sender: '0xAbCdEf7890123456789012345678901234567890',
        result: { data: 'test' }
      }
      const result = validateOutcomeMessage(messageWithMixedCaseSender)
      expect(result.sender).toBe('0xAbCdEf7890123456789012345678901234567890')
    })
  })

  describe('and the error message exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongErrorMessage = {
        requestId: generateRandomIdentityId(),
        sender: '0x1234567890123456789012345678901234567890',
        error: {
          code: 1000,
          message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1)
        }
      }
      expect(() => validateOutcomeMessage(messageWithLongErrorMessage)).toThrow()
    })
  })

  describe('and the error message is at max length', () => {
    it('should return the validated message', () => {
      const messageWithMaxErrorMessage = {
        requestId: generateRandomIdentityId(),
        sender: '0x1234567890123456789012345678901234567890',
        error: {
          code: 1000,
          message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH)
        }
      }
      const result = validateOutcomeMessage(messageWithMaxErrorMessage)
      expect(result.error?.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)
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

  describe('and the requestId exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1)
      }
      expect(() => validateRequestValidationMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the requestId is at max length', () => {
    it('should return the validated message', () => {
      const messageWithMaxRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH)
      }
      const result = validateRequestValidationMessage(messageWithMaxRequestId)
      expect(result.requestId).toHaveLength(MAX_REQUEST_ID_LENGTH)
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

  describe('and the sender is not a valid Ethereum address', () => {
    it('should throw validation error for invalid format', () => {
      const messageWithInvalidSender = {
        sender: 'invalid-sender-address',
        result: { data: 'test' }
      }
      expect(() => validateHttpOutcomeMessage(messageWithInvalidSender)).toThrow()
    })

    it('should throw validation error for address without 0x prefix', () => {
      const messageWithoutPrefix = {
        sender: '1234567890123456789012345678901234567890',
        result: { data: 'test' }
      }
      expect(() => validateHttpOutcomeMessage(messageWithoutPrefix)).toThrow()
    })
  })

  describe('and the sender is a valid Ethereum address', () => {
    it('should return the validated message', () => {
      const messageWithValidSender = {
        sender: '0x1234567890123456789012345678901234567890',
        result: { data: 'test' }
      }
      const result = validateHttpOutcomeMessage(messageWithValidSender)
      expect(result.sender).toBe('0x1234567890123456789012345678901234567890')
    })
  })

  describe('and the error message exceeds max length', () => {
    it('should throw validation error', () => {
      const messageWithLongErrorMessage = {
        sender: '0x1234567890123456789012345678901234567890',
        error: {
          code: 1000,
          message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1)
        }
      }
      expect(() => validateHttpOutcomeMessage(messageWithLongErrorMessage)).toThrow()
    })
  })

  describe('and the error message is at max length', () => {
    it('should return the validated message', () => {
      const messageWithMaxErrorMessage = {
        sender: '0x1234567890123456789012345678901234567890',
        error: {
          code: 1000,
          message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH)
        }
      }
      const result = validateHttpOutcomeMessage(messageWithMaxErrorMessage)
      expect(result.error?.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)
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
