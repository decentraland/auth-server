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
  describe('and the message is valid', () => {
    let validRequestMessage: RequestMessage

    beforeEach(() => {
      validRequestMessage = {
        method: 'eth_sendTransaction',
        params: [{ from: '0x123', to: '0x456', value: '0x1' }]
      }
    })

    it('should return the validated message', () => {
      expect(validateRequestMessage(validRequestMessage)).toEqual(validRequestMessage)
    })
  })

  describe('and the message is missing the method', () => {
    let invalidRequestMessage: Partial<RequestMessage>

    beforeEach(() => {
      invalidRequestMessage = { params: [] }
    })

    it('should throw a validation error', () => {
      expect(() => validateRequestMessage(invalidRequestMessage)).toThrow()
    })
  })

  describe('and the method exceeds max length', () => {
    let messageWithLongMethod: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithLongMethod = { method: 'a'.repeat(MAX_METHOD_LENGTH + 1), params: [] }
    })

    it('should throw a validation error', () => {
      expect(() => validateRequestMessage(messageWithLongMethod)).toThrow()
    })
  })

  describe('and the method is at max length', () => {
    let messageWithMaxMethod: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithMaxMethod = { method: 'a'.repeat(MAX_METHOD_LENGTH), params: [] }
    })

    it('should return a message whose method is at the max length', () => {
      expect(validateRequestMessage(messageWithMaxMethod).method).toHaveLength(MAX_METHOD_LENGTH)
    })
  })

  describe('and the params array exceeds max items', () => {
    let messageWithTooManyParams: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithTooManyParams = { method: 'eth_call', params: Array(MAX_PARAMS_ITEMS + 1).fill({ data: 'test' }) }
    })

    it('should throw a validation error', () => {
      expect(() => validateRequestMessage(messageWithTooManyParams)).toThrow()
    })
  })

  describe('and the params array is at max items', () => {
    let messageWithMaxParams: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithMaxParams = { method: 'eth_call', params: Array(MAX_PARAMS_ITEMS).fill({ data: 'test' }) }
    })

    it('should return a message with the max number of params', () => {
      expect(validateRequestMessage(messageWithMaxParams).params).toHaveLength(MAX_PARAMS_ITEMS)
    })
  })
})

describe('when validating recover messages', () => {
  describe('and the message is valid', () => {
    let validRecoverMessage: RecoverMessage

    beforeEach(() => {
      validRecoverMessage = { requestId: generateRandomIdentityId() }
    })

    it('should return the validated message', () => {
      expect(validateRecoverMessage(validRecoverMessage)).toEqual(validRecoverMessage)
    })
  })

  describe('and the message is missing the requestId', () => {
    let invalidRecoverMessage: Partial<RecoverMessage>

    beforeEach(() => {
      invalidRecoverMessage = {}
    })

    it('should throw a validation error', () => {
      expect(() => validateRecoverMessage(invalidRecoverMessage)).toThrow()
    })
  })

  describe('and the requestId exceeds max length', () => {
    let messageWithLongRequestId: { requestId: string }

    beforeEach(() => {
      messageWithLongRequestId = { requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1) }
    })

    it('should throw a validation error', () => {
      expect(() => validateRecoverMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the requestId is at max length', () => {
    let messageWithMaxRequestId: { requestId: string }

    beforeEach(() => {
      messageWithMaxRequestId = { requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH) }
    })

    it('should return a message whose requestId is at the max length', () => {
      expect(validateRecoverMessage(messageWithMaxRequestId).requestId).toHaveLength(MAX_REQUEST_ID_LENGTH)
    })
  })
})

describe('when validating outcome messages', () => {
  let requestId: string
  let sender: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
    sender = createUnsafeIdentity().address
  })

  describe('and the message has a valid result', () => {
    let validOutcomeMessageWithResult: OutcomeMessage

    beforeEach(() => {
      validOutcomeMessageWithResult = { requestId, sender, result: { transactionHash: '0xabcdef' } }
    })

    it('should return the validated message', () => {
      expect(validateOutcomeMessage(validOutcomeMessageWithResult)).toEqual(validOutcomeMessageWithResult)
    })
  })

  describe('and the message has a valid error', () => {
    let validOutcomeMessageWithError: OutcomeMessage

    beforeEach(() => {
      validOutcomeMessageWithError = { requestId, sender, error: { code: 1233, message: 'Transaction failed' } }
    })

    it('should return the validated message', () => {
      expect(validateOutcomeMessage(validOutcomeMessageWithError)).toEqual(validOutcomeMessageWithError)
    })
  })

  describe('and the message has neither a result nor an error', () => {
    let invalidOutcomeMessage: Partial<OutcomeMessage>

    beforeEach(() => {
      invalidOutcomeMessage = { requestId, sender }
    })

    it('should throw a validation error', () => {
      expect(() => validateOutcomeMessage(invalidOutcomeMessage)).toThrow()
    })
  })

  describe('and the requestId exceeds max length', () => {
    let messageWithLongRequestId: Record<string, unknown>

    beforeEach(() => {
      messageWithLongRequestId = {
        requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1),
        sender: '0x1234567890123456789012345678901234567890',
        result: { data: 'test' }
      }
    })

    it('should throw a validation error', () => {
      expect(() => validateOutcomeMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the sender is not a valid Ethereum address', () => {
    describe('and the sender has an arbitrary invalid format', () => {
      let messageWithInvalidSender: Record<string, unknown>

      beforeEach(() => {
        messageWithInvalidSender = { requestId: generateRandomIdentityId(), sender: 'invalid-sender-address', result: { data: 'test' } }
      })

      it('should throw a validation error', () => {
        expect(() => validateOutcomeMessage(messageWithInvalidSender)).toThrow()
      })
    })

    describe('and the sender is missing the 0x prefix', () => {
      let messageWithoutPrefix: Record<string, unknown>

      beforeEach(() => {
        messageWithoutPrefix = {
          requestId: generateRandomIdentityId(),
          sender: '1234567890123456789012345678901234567890',
          result: { data: 'test' }
        }
      })

      it('should throw a validation error', () => {
        expect(() => validateOutcomeMessage(messageWithoutPrefix)).toThrow()
      })
    })

    describe('and the sender has the wrong length', () => {
      let messageWithShortAddress: Record<string, unknown>

      beforeEach(() => {
        messageWithShortAddress = {
          requestId: generateRandomIdentityId(),
          sender: '0x123456789012345678901234567890123456789', // 39 chars instead of 40
          result: { data: 'test' }
        }
      })

      it('should throw a validation error', () => {
        expect(() => validateOutcomeMessage(messageWithShortAddress)).toThrow()
      })
    })

    describe('and the sender has invalid characters', () => {
      let messageWithInvalidChars: Record<string, unknown>

      beforeEach(() => {
        messageWithInvalidChars = {
          requestId: generateRandomIdentityId(),
          sender: '0xGGGG567890123456789012345678901234567890', // G is not hex
          result: { data: 'test' }
        }
      })

      it('should throw a validation error', () => {
        expect(() => validateOutcomeMessage(messageWithInvalidChars)).toThrow()
      })
    })
  })

  describe('and the sender is a valid Ethereum address', () => {
    describe('and the address is lowercase', () => {
      let messageWithLowercaseSender: Record<string, unknown>

      beforeEach(() => {
        messageWithLowercaseSender = {
          requestId: generateRandomIdentityId(),
          sender: '0xabcdef7890123456789012345678901234567890',
          result: { data: 'test' }
        }
      })

      it('should return the message with the lowercase sender', () => {
        expect(validateOutcomeMessage(messageWithLowercaseSender).sender).toBe('0xabcdef7890123456789012345678901234567890')
      })
    })

    describe('and the address is uppercase', () => {
      let messageWithUppercaseSender: Record<string, unknown>

      beforeEach(() => {
        messageWithUppercaseSender = {
          requestId: generateRandomIdentityId(),
          sender: '0xABCDEF7890123456789012345678901234567890',
          result: { data: 'test' }
        }
      })

      it('should return the message with the uppercase sender', () => {
        expect(validateOutcomeMessage(messageWithUppercaseSender).sender).toBe('0xABCDEF7890123456789012345678901234567890')
      })
    })

    describe('and the address is mixed case', () => {
      let messageWithMixedCaseSender: Record<string, unknown>

      beforeEach(() => {
        messageWithMixedCaseSender = {
          requestId: generateRandomIdentityId(),
          sender: '0xAbCdEf7890123456789012345678901234567890',
          result: { data: 'test' }
        }
      })

      it('should return the message with the mixed case sender', () => {
        expect(validateOutcomeMessage(messageWithMixedCaseSender).sender).toBe('0xAbCdEf7890123456789012345678901234567890')
      })
    })
  })

  describe('and the error message exceeds max length', () => {
    let messageWithLongErrorMessage: Record<string, unknown>

    beforeEach(() => {
      messageWithLongErrorMessage = {
        requestId: generateRandomIdentityId(),
        sender: '0x1234567890123456789012345678901234567890',
        error: { code: 1000, message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1) }
      }
    })

    it('should throw a validation error', () => {
      expect(() => validateOutcomeMessage(messageWithLongErrorMessage)).toThrow()
    })
  })

  describe('and the error message is at max length', () => {
    let messageWithMaxErrorMessage: Record<string, unknown>

    beforeEach(() => {
      messageWithMaxErrorMessage = {
        requestId: generateRandomIdentityId(),
        sender: '0x1234567890123456789012345678901234567890',
        error: { code: 1000, message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH) }
      }
    })

    it('should return a message whose error message is at the max length', () => {
      expect(validateOutcomeMessage(messageWithMaxErrorMessage).error?.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)
    })
  })
})

describe('when validating request validation messages', () => {
  describe('and the message is valid', () => {
    let validRequestValidationMessage: RequestValidationMessage

    beforeEach(() => {
      validRequestValidationMessage = { requestId: generateRandomIdentityId() }
    })

    it('should return the validated message', () => {
      expect(validateRequestValidationMessage(validRequestValidationMessage)).toEqual(validRequestValidationMessage)
    })
  })

  describe('and the message is missing the requestId', () => {
    let invalidRequestValidationMessage: Partial<RequestValidationMessage>

    beforeEach(() => {
      invalidRequestValidationMessage = {}
    })

    it('should throw a validation error', () => {
      expect(() => validateRequestValidationMessage(invalidRequestValidationMessage)).toThrow()
    })
  })

  describe('and the requestId exceeds max length', () => {
    let messageWithLongRequestId: { requestId: string }

    beforeEach(() => {
      messageWithLongRequestId = { requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1) }
    })

    it('should throw a validation error', () => {
      expect(() => validateRequestValidationMessage(messageWithLongRequestId)).toThrow()
    })
  })

  describe('and the requestId is at max length', () => {
    let messageWithMaxRequestId: { requestId: string }

    beforeEach(() => {
      messageWithMaxRequestId = { requestId: 'a'.repeat(MAX_REQUEST_ID_LENGTH) }
    })

    it('should return a message whose requestId is at the max length', () => {
      expect(validateRequestValidationMessage(messageWithMaxRequestId).requestId).toHaveLength(MAX_REQUEST_ID_LENGTH)
    })
  })
})

describe('when validating identity IDs', () => {
  describe('and the identity ID is a valid UUID v4', () => {
    let validIdentityId: string

    beforeEach(() => {
      validIdentityId = generateRandomIdentityId()
    })

    it('should return true', () => {
      expect(validateIdentityId(validIdentityId)).toBe(true)
    })
  })

  describe('and the identity ID has an invalid format', () => {
    let invalidIdentityId: string

    beforeEach(() => {
      invalidIdentityId = 'invalid-uuid-format'
    })

    it('should return false', () => {
      expect(validateIdentityId(invalidIdentityId)).toBe(false)
    })
  })

  describe('and the identity ID is empty', () => {
    let emptyIdentityId: string

    beforeEach(() => {
      emptyIdentityId = ''
    })

    it('should return false', () => {
      expect(validateIdentityId(emptyIdentityId)).toBe(false)
    })
  })

  describe('and the identity ID is null', () => {
    it('should return false', () => {
      expect(validateIdentityId(null as unknown as string)).toBe(false)
    })
  })

  describe('and the identity ID is not a string', () => {
    it('should return false', () => {
      expect(validateIdentityId(123 as unknown as string)).toBe(false)
    })
  })
})

describe('when validating HTTP outcome messages', () => {
  describe('and the message is valid', () => {
    let sender: string
    let validHttpOutcomeMessage: HttpOutcomeMessage

    beforeEach(() => {
      sender = createUnsafeIdentity().address
      validHttpOutcomeMessage = { sender, result: { transactionHash: '0xabcdef' } }
    })

    it('should return the validated message', () => {
      expect(validateHttpOutcomeMessage(validHttpOutcomeMessage)).toEqual(validHttpOutcomeMessage)
    })
  })

  describe('and the message is missing the sender', () => {
    let invalidHttpOutcomeMessage: Partial<HttpOutcomeMessage>

    beforeEach(() => {
      invalidHttpOutcomeMessage = { result: { transactionHash: '0xabcdef' } }
    })

    it('should throw a validation error', () => {
      expect(() => validateHttpOutcomeMessage(invalidHttpOutcomeMessage)).toThrow()
    })
  })

  describe('and the sender is not a valid Ethereum address', () => {
    describe('and the sender has an arbitrary invalid format', () => {
      let messageWithInvalidSender: Record<string, unknown>

      beforeEach(() => {
        messageWithInvalidSender = { sender: 'invalid-sender-address', result: { data: 'test' } }
      })

      it('should throw a validation error', () => {
        expect(() => validateHttpOutcomeMessage(messageWithInvalidSender)).toThrow()
      })
    })

    describe('and the sender is missing the 0x prefix', () => {
      let messageWithoutPrefix: Record<string, unknown>

      beforeEach(() => {
        messageWithoutPrefix = { sender: '1234567890123456789012345678901234567890', result: { data: 'test' } }
      })

      it('should throw a validation error', () => {
        expect(() => validateHttpOutcomeMessage(messageWithoutPrefix)).toThrow()
      })
    })
  })

  describe('and the sender is a valid Ethereum address', () => {
    let messageWithValidSender: Record<string, unknown>

    beforeEach(() => {
      messageWithValidSender = { sender: '0x1234567890123456789012345678901234567890', result: { data: 'test' } }
    })

    it('should return the message with the valid sender', () => {
      expect(validateHttpOutcomeMessage(messageWithValidSender).sender).toBe('0x1234567890123456789012345678901234567890')
    })
  })

  describe('and the error message exceeds max length', () => {
    let messageWithLongErrorMessage: Record<string, unknown>

    beforeEach(() => {
      messageWithLongErrorMessage = {
        sender: '0x1234567890123456789012345678901234567890',
        error: { code: 1000, message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1) }
      }
    })

    it('should throw a validation error', () => {
      expect(() => validateHttpOutcomeMessage(messageWithLongErrorMessage)).toThrow()
    })
  })

  describe('and the error message is at max length', () => {
    let messageWithMaxErrorMessage: Record<string, unknown>

    beforeEach(() => {
      messageWithMaxErrorMessage = {
        sender: '0x1234567890123456789012345678901234567890',
        error: { code: 1000, message: 'a'.repeat(MAX_ERROR_MESSAGE_LENGTH) }
      }
    })

    it('should return a message whose error message is at the max length', () => {
      expect(validateHttpOutcomeMessage(messageWithMaxErrorMessage).error?.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)
    })
  })
})

describe('when validating identity requests', () => {
  describe('and the message is valid', () => {
    let validIdentityRequest: unknown

    beforeEach(async () => {
      const testIdentity = await createTestIdentity()
      // Convert Date to ISO string as expected by the schema
      const identityWithStringExpiration = {
        ...testIdentity,
        expiration: testIdentity.expiration.toISOString()
      }
      validIdentityRequest = { identity: identityWithStringExpiration }
    })

    it('should return the validated message', () => {
      expect(validateIdentityRequest(validIdentityRequest)).toEqual(validIdentityRequest)
    })
  })

  describe('and the message is missing the identity field', () => {
    let invalidIdentityRequest: unknown

    beforeEach(() => {
      invalidIdentityRequest = { expiration: new Date().toISOString() }
    })

    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest(invalidIdentityRequest)).toThrow()
    })
  })

  describe('and the message has an invalid identity structure', () => {
    let invalidIdentityRequestInvalidIdentity: unknown

    beforeEach(() => {
      invalidIdentityRequestInvalidIdentity = {
        identity: {
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

    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest(invalidIdentityRequestInvalidIdentity)).toThrow()
    })
  })

  describe('and the message is undefined', () => {
    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest(undefined)).toThrow()
    })
  })

  describe('and the message is a string', () => {
    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest('invalid-string')).toThrow()
    })
  })

  describe('and the message is a number', () => {
    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest(123)).toThrow()
    })
  })

  describe('and the message is an array', () => {
    it('should throw a validation error', () => {
      expect(() => validateIdentityRequest([])).toThrow()
    })
  })
})
