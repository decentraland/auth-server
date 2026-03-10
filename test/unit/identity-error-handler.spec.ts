import type { ILoggerComponent } from '@well-known-components/interfaces'
import { handleIdentityValidationError } from '../../src/controllers/handlers/identity-handlers/identity-error-handler'
import {
  EphemeralAddressMismatchError,
  EphemeralKeyExpiredError,
  EphemeralPrivateKeyMismatchError,
  RequestSenderMismatchError
} from '../../src/logic/errors'

describe('when handling an identity validation error', () => {
  let logger: ILoggerComponent.ILogger

  beforeEach(() => {
    logger = { log: jest.fn(), error: jest.fn() } as unknown as ILoggerComponent.ILogger
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  describe('and the error is an EphemeralKeyExpiredError', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError(new EphemeralKeyExpiredError(), logger, '0xsender')
    })

    it('should return status 401', () => {
      expect(result.status).toBe(401)
    })

    it('should include the error message', () => {
      expect(result.body.error).toBe('Ephemeral key has expired')
    })
  })

  describe('and the error is an EphemeralAddressMismatchError', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError(new EphemeralAddressMismatchError('0xaddr', '0xfinal'), logger, '0xsender')
    })

    it('should return status 403', () => {
      expect(result.status).toBe(403)
    })

    it('should include the error message', () => {
      expect(result.body.error).toBe('Ephemeral wallet address does not match auth chain final authority')
    })
  })

  describe('and the error is a RequestSenderMismatchError', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError(new RequestSenderMismatchError('0xreq', '0xid'), logger, '0xsender')
    })

    it('should return status 403', () => {
      expect(result.status).toBe(403)
    })

    it('should include the error message', () => {
      expect(result.body.error).toBe('Request sender does not match identity owner')
    })
  })

  describe('and the error is an EphemeralPrivateKeyMismatchError', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError(new EphemeralPrivateKeyMismatchError('0xaddr'), logger, '0xsender')
    })

    it('should return status 403', () => {
      expect(result.status).toBe(403)
    })

    it('should include the error message', () => {
      expect(result.body.error).toBe('Ephemeral private key does not match the provided address')
    })
  })

  describe('and the error is an unrecognized Error instance', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError(new Error('unexpected failure'), logger, undefined)
    })

    it('should return status 400', () => {
      expect(result.status).toBe(400)
    })

    it('should include the error message', () => {
      expect(result.body.error).toBe('unexpected failure')
    })
  })

  describe('and the error is not an Error instance', () => {
    let result: ReturnType<typeof handleIdentityValidationError>

    beforeEach(() => {
      result = handleIdentityValidationError('not an error object', logger, undefined)
    })

    it('should return status 400', () => {
      expect(result.status).toBe(400)
    })

    it('should return an unknown error message', () => {
      expect(result.body.error).toBe('Unknown error')
    })
  })
})
