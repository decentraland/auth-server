import { OutcomeResponseMessage } from '../../src/ports/server/types'
import { validateOutcomeMessage } from '../../src/ports/server/validations'

describe('when validating the outcome', () => {
  let outcome: OutcomeResponseMessage

  describe('and the outcome does not contain a sender', () => {
    beforeEach(() => {
      outcome = {
        requestId: 'requestId',
        result: 'result'
      } as any
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })

  describe('and the outcome does not contain a requestId', () => {
    beforeEach(() => {
      outcome = {
        sender: 'sender',
        result: 'result'
      } as any
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })

  describe('and the outcome contains a result', () => {
    beforeEach(() => {
      outcome = {
        requestId: 'requestId',
        sender: 'sender',
        result: 'result'
      } as any
    })

    it('should return the outcome', () => {
      expect(validateOutcomeMessage(outcome)).toBe(outcome)
    })
  })

  describe('and the outcome contains an error', () => {
    beforeEach(() => {
      outcome = {
        requestId: 'requestId',
        sender: 'sender',
        error: {}
      } as any
    })

    describe('and the error is missing a code', () => {
      beforeEach(() => {
        outcome.error = {
          message: 'message'
        } as any
      })

      it('should throw an error', () => {
        expect(() => validateOutcomeMessage(outcome)).toThrowError()
      })
    })

    describe('and the error is missing a message', () => {
      beforeEach(() => {
        outcome.error = {
          code: 123
        } as any
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
    beforeEach(() => {
      outcome = {
        requestId: 'requestId',
        sender: 'sender',
        result: 'result',
        error: {
          code: 1,
          message: 'message'
        }
      } as any
    })

    it('should throw an error', () => {
      expect(() => validateOutcomeMessage(outcome)).toThrowError()
    })
  })
})
