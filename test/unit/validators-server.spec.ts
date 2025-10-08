import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { OutcomeResponseMessage } from '../../src/ports/server/types'
import { validateOutcomeMessage } from '../../src/ports/server/validations'
import { generateRandomIdentityId } from '../utils/test-identity'

describe('when validating the outcome', () => {
  let outcome: OutcomeResponseMessage

  describe('and the outcome does not contain a sender', () => {
    let requestId: string

    beforeEach(() => {
      requestId = generateRandomIdentityId()
      outcome = {
        requestId,
        result: 'result'
      } as OutcomeResponseMessage
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })

  describe('and the outcome does not contain a requestId', () => {
    let sender: string

    beforeEach(() => {
      sender = createUnsafeIdentity().address
      outcome = {
        sender,
        result: 'result'
      } as OutcomeResponseMessage
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })

  describe('and the outcome contains a result', () => {
    let requestId: string
    let sender: string

    beforeEach(() => {
      requestId = generateRandomIdentityId()
      sender = createUnsafeIdentity().address
      outcome = {
        requestId,
        sender,
        result: 'result'
      } as OutcomeResponseMessage
    })

    it('should return the outcome', () => {
      expect(validateOutcomeMessage(outcome)).toBe(outcome)
    })
  })

  describe('and the outcome contains an error', () => {
    let requestId: string
    let sender: string

    beforeEach(() => {
      requestId = generateRandomIdentityId()
      sender = createUnsafeIdentity().address
      outcome = {
        requestId,
        sender,
        error: {}
      } as OutcomeResponseMessage
    })

    describe('and the error is missing a code', () => {
      beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(outcome as any).error = {
          message: 'message'
        } as any // eslint-disable-line @typescript-eslint/no-explicit-any
      })

      it('should throw an error', () => {
        expect(() => validateOutcomeMessage(outcome)).toThrowError()
      })
    })

    describe('and the error is missing a message', () => {
      beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(outcome as any).error = {
          code: 123
        } as any // eslint-disable-line @typescript-eslint/no-explicit-any
      })

      it('should throw an error', () => {
        expect(() => validateOutcomeMessage(outcome)).toThrowError()
      })
    })

    describe('and the error contains a code and a message', () => {
      beforeEach(() => {
        outcome.error = {
          code: 1,
          message: 'message'
        }
      })

      it('should return the outcome', () => {
        expect(validateOutcomeMessage(outcome)).toBe(outcome)
      })
    })
  })

  describe('and the outcome contains both a result and an error', () => {
    let requestId: string
    let sender: string

    beforeEach(() => {
      requestId = generateRandomIdentityId()
      sender = createUnsafeIdentity().address
      outcome = {
        requestId,
        sender,
        result: 'result',
        error: {
          code: 1,
          message: 'message'
        }
      } as OutcomeResponseMessage
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })
})
