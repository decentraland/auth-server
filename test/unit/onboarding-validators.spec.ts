import { CheckpointRequest } from '../../src/ports/server/types'
import { validateCheckpointRequest } from '../../src/ports/server/validations'

describe('when validating a checkpoint request', () => {
  describe('and the payload is valid', () => {
    describe('and it uses a wallet identifier with a reached action', () => {
      let payload: CheckpointRequest

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: '0xabc123def', identifierType: 'wallet', action: 'reached' }
      })

      it('should return the validated request', () => {
        expect(validateCheckpointRequest(payload)).toMatchObject({ checkpointId: 3, identifierType: 'wallet', action: 'reached' })
      })
    })

    describe('and it uses an email identifier with a completed action', () => {
      let payload: CheckpointRequest

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email', action: 'completed' }
      })

      it('should return the validated request', () => {
        expect(validateCheckpointRequest(payload)).toMatchObject({ action: 'completed', identifierType: 'email' })
      })
    })

    describe('and it includes an optional valid email', () => {
      let payload: CheckpointRequest

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: '0xabc', identifierType: 'wallet', action: 'reached', email: 'user@decentraland.org' }
      })

      it('should return the request with the email', () => {
        expect(validateCheckpointRequest(payload).email).toBe('user@decentraland.org')
      })
    })

    describe('and it includes an optional source', () => {
      let payload: CheckpointRequest

      beforeEach(() => {
        payload = { checkpointId: 1, userIdentifier: 'anon', identifierType: 'wallet', action: 'reached', source: 'auth' }
      })

      it('should return the request with the source', () => {
        expect(validateCheckpointRequest(payload).source).toBe('auth')
      })
    })

    describe('and it includes an optional metadata object', () => {
      let payload: CheckpointRequest

      beforeEach(() => {
        payload = {
          checkpointId: 2,
          userIdentifier: 'user@test.com',
          identifierType: 'email',
          action: 'reached',
          metadata: { loginMethod: 'metamask', platform: 'desktop' }
        }
      })

      it('should return the request with the metadata', () => {
        expect(validateCheckpointRequest(payload).metadata).toEqual({ loginMethod: 'metamask', platform: 'desktop' })
      })
    })

    describe('and the checkpointId is any value from 1 to 7', () => {
      let validCheckpointIds: number[]

      beforeEach(() => {
        validCheckpointIds = [1, 2, 3, 4, 5, 6, 7]
      })

      it('should accept every checkpoint id in range', () => {
        for (const checkpointId of validCheckpointIds) {
          expect(() =>
            validateCheckpointRequest({ checkpointId, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' })
          ).not.toThrow()
        }
      })
    })
  })

  describe('and the payload is invalid', () => {
    describe('and the checkpointId is below the minimum', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 0, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the checkpointId is above the maximum', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 8, userIdentifier: 'x', identifierType: 'wallet', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the identifierType is unknown', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', identifierType: 'phone', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the action is unknown', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet', action: 'viewed' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the email is malformed', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet', action: 'reached', email: 'not-an-email' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the checkpointId is missing', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { userIdentifier: 'x', identifierType: 'wallet', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the userIdentifier is missing', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, identifierType: 'wallet', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the identifierType is missing', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the action is missing', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and the userIdentifier is empty', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: '', identifierType: 'wallet', action: 'reached' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })

    describe('and there are additional unknown properties', () => {
      let payload: Record<string, unknown>

      beforeEach(() => {
        payload = { checkpointId: 3, userIdentifier: 'x', identifierType: 'wallet', action: 'reached', unknownField: 'value' }
      })

      it('should throw a validation error', () => {
        expect(() => validateCheckpointRequest(payload)).toThrow()
      })
    })
  })
})
