import { Authenticator } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { isEphemeralMessage } from '../../src/logic/auth-chain'
import { MAX_METHOD_LENGTH, MAX_PARAMS_ITEMS, MAX_ERROR_MESSAGE_LENGTH, MAX_REQUEST_ID_LENGTH } from '../../src/ports/server/constants'
import {
  RequestMessage,
  RecoverMessage,
  OutcomeMessage,
  RequestValidationMessage,
  HttpOutcomeMessage,
  IdentityRequest,
  ValidatedRequestMessage
} from '../../src/ports/server/types'
import {
  validateRequestMessage,
  validateRecoverMessage,
  validateOutcomeMessage,
  validateRequestValidationMessage,
  validateIdentityId,
  validateHttpOutcomeMessage,
  validateIdentityRequest,
  isDisallowedMethod
} from '../../src/ports/server/validations'
import { generateRandomIdentityId, createTestIdentity } from '../utils/test-identity'

/**
 * A well-shaped auth chain. `validateRequestMessage` only requires the chain to be present and to
 * match the schema — signatures are verified separately by `validateAuthChain` — so a single SIGNER
 * link is enough to exercise these cases.
 */
function createStubAuthChain(): AuthChain {
  return [{ type: AuthLinkType.SIGNER, payload: '0x1234567890123456789012345678901234567890', signature: '' }]
}

describe('when validating request messages', () => {
  describe('and the message is valid', () => {
    let validRequestMessage: ValidatedRequestMessage

    beforeEach(() => {
      validRequestMessage = {
        method: 'eth_sendTransaction',
        params: [{ from: '0x123', to: '0x456', value: '0x1' }],
        authChain: createStubAuthChain()
      }
    })

    it('should return the validated message', () => {
      expect(validateRequestMessage(validRequestMessage)).toEqual(validRequestMessage)
    })
  })

  describe('and the message carries an integer timestamp', () => {
    let signedRequestMessage: ValidatedRequestMessage
    beforeEach(() => {
      signedRequestMessage = {
        method: 'eth_sendTransaction',
        params: [{ from: '0x123', to: '0x456', value: '0x1' }],
        authChain: createStubAuthChain(),
        timestamp: 1700000000000
      }
    })
    it('should return the validated message with the timestamp', () => {
      expect(validateRequestMessage(signedRequestMessage)).toEqual(signedRequestMessage)
    })
  })

  describe('and the timestamp is not an integer', () => {
    let invalidRequestMessage: unknown
    beforeEach(() => {
      invalidRequestMessage = {
        method: 'eth_sendTransaction',
        params: [],
        authChain: createStubAuthChain(),
        timestamp: '1700000000000'
      }
    })
    it('should throw a validation error', () => {
      expect(() => validateRequestMessage(invalidRequestMessage)).toThrow()
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
    let messageWithMaxMethod: { method: string; params: unknown[]; authChain: AuthChain }

    beforeEach(() => {
      messageWithMaxMethod = { method: 'a'.repeat(MAX_METHOD_LENGTH), params: [], authChain: createStubAuthChain() }
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
    let messageWithMaxParams: { method: string; params: unknown[]; authChain: AuthChain }

    beforeEach(() => {
      messageWithMaxParams = {
        method: 'eth_call',
        params: Array(MAX_PARAMS_ITEMS).fill({ data: 'test' }),
        authChain: createStubAuthChain()
      }
    })

    it('should return a message with the max number of params', () => {
      expect(validateRequestMessage(messageWithMaxParams).params).toHaveLength(MAX_PARAMS_ITEMS)
    })
  })

  describe('and the method is dcl_personal_sign', () => {
    let messageWithDclPersonalSign: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithDclPersonalSign = { method: 'dcl_personal_sign', params: [] }
    })

    it('should throw an error indicating that the dcl_personal_sign method is not allowed', () => {
      expect(() => validateRequestMessage(messageWithDclPersonalSign)).toThrow('The dcl_personal_sign method is not allowed')
    })
  })

  describe('and the method is dcl_personal_sign written in a different casing', () => {
    let messageWithMixedCaseMethod: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithMixedCaseMethod = { method: 'DCL_Personal_Sign', params: [] }
    })

    it('should throw an error indicating that the dcl_personal_sign method is not allowed', () => {
      expect(() => validateRequestMessage(messageWithMixedCaseMethod)).toThrow('The dcl_personal_sign method is not allowed')
    })
  })

  describe('and the method is personal_sign for an ordinary message', () => {
    let messageWithPersonalSign: ValidatedRequestMessage

    beforeEach(() => {
      messageWithPersonalSign = {
        method: 'personal_sign',
        params: ['Please sign to confirm your order', '0x1234567890123456789012345678901234567890'],
        authChain: createStubAuthChain()
      }
    })

    it('should return the validated message', () => {
      expect(validateRequestMessage(messageWithPersonalSign)).toEqual(messageWithPersonalSign)
    })
  })

  describe('and the method is personal_sign for a Decentraland ephemeral message', () => {
    let messageWithEphemeralPayload: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithEphemeralPayload = {
        method: 'personal_sign',
        params: [Authenticator.getEphemeralMessage('0x1234567890123456789012345678901234567890', new Date('2100-01-01T00:00:00.000Z'))]
      }
    })

    it('should throw an error indicating that signing an ephemeral message is not allowed', () => {
      expect(() => validateRequestMessage(messageWithEphemeralPayload)).toThrow('Signing a Decentraland ephemeral message is not allowed')
    })
  })

  describe('and the method is personal_sign for a hex encoded Decentraland ephemeral message', () => {
    let messageWithHexEphemeralPayload: { method: string; params: unknown[] }

    beforeEach(() => {
      const ephemeralMessage = Authenticator.getEphemeralMessage(
        '0x1234567890123456789012345678901234567890',
        new Date('2100-01-01T00:00:00.000Z')
      )
      messageWithHexEphemeralPayload = {
        method: 'personal_sign',
        params: [`0x${Buffer.from(ephemeralMessage, 'utf8').toString('hex')}`]
      }
    })

    it('should throw an error indicating that signing an ephemeral message is not allowed', () => {
      expect(() => validateRequestMessage(messageWithHexEphemeralPayload)).toThrow(
        'Signing a Decentraland ephemeral message is not allowed'
      )
    })
  })

  describe('and the method is eth_sign for a Decentraland ephemeral message', () => {
    let messageWithEphemeralPayload: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithEphemeralPayload = {
        method: 'eth_sign',
        params: [
          '0x1234567890123456789012345678901234567890',
          Authenticator.getEphemeralMessage('0x1234567890123456789012345678901234567890', new Date('2100-01-01T00:00:00.000Z'))
        ]
      }
    })

    it('should throw an error indicating that signing an ephemeral message is not allowed', () => {
      expect(() => validateRequestMessage(messageWithEphemeralPayload)).toThrow('Signing a Decentraland ephemeral message is not allowed')
    })
  })

  describe('and the method is personal_sign for an ephemeral message with a disguised first line', () => {
    let messageWithDisguisedEphemeralPayload: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithDisguisedEphemeralPayload = {
        method: 'personal_sign',
        params: [
          'Totally harmless greeting\nEphemeral address: 0x1234567890123456789012345678901234567890\nExpiration: 2100-01-01T00:00:00.000Z'
        ]
      }
    })

    it('should throw an error indicating that signing an ephemeral message is not allowed', () => {
      expect(() => validateRequestMessage(messageWithDisguisedEphemeralPayload)).toThrow(
        'Signing a Decentraland ephemeral message is not allowed'
      )
    })
  })

  describe('and the method is a non signing wallet method', () => {
    let messageWithNonSigningMethod: ValidatedRequestMessage

    beforeEach(() => {
      messageWithNonSigningMethod = {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
        authChain: createStubAuthChain()
      }
    })

    it('should return the validated message', () => {
      expect(validateRequestMessage(messageWithNonSigningMethod)).toEqual(messageWithNonSigningMethod)
    })
  })

  describe('and the auth chain is not provided', () => {
    let messageWithoutAuthChain: { method: string; params: unknown[] }

    beforeEach(() => {
      messageWithoutAuthChain = { method: 'eth_sendTransaction', params: [{ from: '0x123', to: '0x456' }] }
    })

    it('should throw an error indicating that the auth chain is required', () => {
      expect(() => validateRequestMessage(messageWithoutAuthChain)).toThrow('Auth chain is required')
    })
  })

  describe('and the auth chain is not provided for a disallowed method', () => {
    let disallowedMessageWithoutAuthChain: { method: string; params: unknown[] }

    beforeEach(() => {
      disallowedMessageWithoutAuthChain = { method: 'dcl_personal_sign', params: [] }
    })

    it('should throw the disallowed method error rather than the auth chain one', () => {
      expect(() => validateRequestMessage(disallowedMessageWithoutAuthChain)).toThrow('The dcl_personal_sign method is not allowed')
    })
  })
})

describe('when checking whether a method is disallowed', () => {
  describe('and the method is dcl_personal_sign', () => {
    let disallowedMethod: string

    beforeEach(() => {
      disallowedMethod = 'dcl_personal_sign'
    })

    it('should return true', () => {
      expect(isDisallowedMethod(disallowedMethod)).toBe(true)
    })
  })

  describe('and the method is personal_sign', () => {
    let allowedMethod: string

    beforeEach(() => {
      allowedMethod = 'personal_sign'
    })

    it('should return false', () => {
      expect(isDisallowedMethod(allowedMethod)).toBe(false)
    })
  })
})

describe('when checking whether a value is a Decentraland ephemeral message', () => {
  describe('and the value is an ephemeral message', () => {
    let ephemeralMessage: string

    beforeEach(() => {
      ephemeralMessage = Authenticator.getEphemeralMessage(
        '0x1234567890123456789012345678901234567890',
        new Date('2100-01-01T00:00:00.000Z')
      )
    })

    it('should return true', () => {
      expect(isEphemeralMessage(ephemeralMessage)).toBe(true)
    })
  })

  describe('and the value is an expired ephemeral message', () => {
    let expiredEphemeralMessage: string

    beforeEach(() => {
      expiredEphemeralMessage = Authenticator.getEphemeralMessage(
        '0x1234567890123456789012345678901234567890',
        new Date('2020-01-01T00:00:00.000Z')
      )
    })

    it('should return true', () => {
      expect(isEphemeralMessage(expiredEphemeralMessage)).toBe(true)
    })
  })

  describe('and the value is an ordinary message', () => {
    let ordinaryMessage: string

    beforeEach(() => {
      ordinaryMessage = 'Please sign to confirm your order'
    })

    it('should return false', () => {
      expect(isEphemeralMessage(ordinaryMessage)).toBe(false)
    })
  })

  describe('and the value is hex encoded transaction data', () => {
    let transactionData: string

    beforeEach(() => {
      transactionData = '0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890'
    })

    it('should return false', () => {
      expect(isEphemeralMessage(transactionData)).toBe(false)
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
