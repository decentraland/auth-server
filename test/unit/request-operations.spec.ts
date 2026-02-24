import { createRequestOperationsComponent } from '../../src/logic/request-operations'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { StorageRequest } from '../../src/ports/storage/types'
import { AppComponents, IRequestOperationsComponent } from '../../src/types/components'

describe('when executing request operation helpers', () => {
  let requestOperations: IRequestOperationsComponent

  beforeEach(async () => {
    const config = {} as AppComponents['config']
    requestOperations = await createRequestOperationsComponent({ config })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  describe('and computing request expiration', () => {
    describe('when the method is not dcl_personal_sign', () => {
      let expiration: Date

      beforeEach(() => {
        expiration = requestOperations.computeRequestExpiration({
          method: 'eth_sendTransaction',
          requestExpirationInSeconds: 60,
          dclPersonalSignExpirationInSeconds: 120,
          now: 1000
        })
      })

      it('should use the generic request expiration window', () => {
        expect(expiration.getTime()).toBe(61000)
      })
    })

    describe('when the method is dcl_personal_sign', () => {
      let expiration: Date

      beforeEach(() => {
        expiration = requestOperations.computeRequestExpiration({
          method: METHOD_DCL_PERSONAL_SIGN,
          requestExpirationInSeconds: 60,
          dclPersonalSignExpirationInSeconds: 120,
          now: 1000
        })
      })

      it('should use the personal sign expiration window', () => {
        expect(expiration.getTime()).toBe(121000)
      })
    })
  })

  describe('and building a request record', () => {
    let record: StorageRequest

    beforeEach(() => {
      record = requestOperations.buildRequestRecord({
        requestId: 'rid-1',
        method: 'eth_call',
        params: [{ foo: 'bar' }],
        expiration: new Date(1000),
        code: 10,
        sender: '0xABCDEF'
      })
    })

    it('should include the request identity and transport fields', () => {
      expect(record).toEqual({
        requestId: 'rid-1',
        method: 'eth_call',
        params: [{ foo: 'bar' }],
        expiration: new Date(1000),
        code: 10,
        sender: '0xabcdef',
        requiresValidation: false
      })
    })
  })

  describe('and checking if a request is expired', () => {
    describe('when expiration is in the past', () => {
      let request: Pick<StorageRequest, 'expiration'>
      let currentDate: Date
      let expired: boolean

      beforeEach(() => {
        request = { expiration: new Date(10) }
        currentDate = new Date(11)
        expired = requestOperations.isRequestExpired(request, currentDate)
      })

      it('should return true', () => {
        expect(expired).toBe(true)
      })
    })

    describe('when expiration equals the current date', () => {
      let request: Pick<StorageRequest, 'expiration'>
      let currentDate: Date
      let expired: boolean

      beforeEach(() => {
        request = { expiration: new Date(10) }
        currentDate = new Date(10)
        expired = requestOperations.isRequestExpired(request, currentDate)
      })

      it('should return false', () => {
        expect(expired).toBe(false)
      })
    })

    describe('when expiration is in the future', () => {
      let request: Pick<StorageRequest, 'expiration'>
      let currentDate: Date
      let expired: boolean

      beforeEach(() => {
        request = { expiration: new Date(10) }
        currentDate = new Date(9)
        expired = requestOperations.isRequestExpired(request, currentDate)
      })

      it('should return false', () => {
        expect(expired).toBe(false)
      })
    })
  })

  describe('and transforming a request into a recover response', () => {
    let recoverResponse: ReturnType<IRequestOperationsComponent['toRecoverResponse']>

    beforeEach(() => {
      recoverResponse = requestOperations.toRecoverResponse({
        expiration: new Date(1000),
        code: 9,
        method: 'method',
        params: [1, 2, 3],
        sender: '0xsender'
      })
    })

    it('should preserve request response fields', () => {
      expect(recoverResponse).toEqual({
        expiration: new Date(1000),
        code: 9,
        method: 'method',
        params: [1, 2, 3],
        sender: '0xsender'
      })
    })
  })

  describe('and transforming outcome payloads', () => {
    let response: ReturnType<IRequestOperationsComponent['toOutcomeResponse']>

    beforeEach(() => {
      response = requestOperations.toOutcomeResponse('rid-1', {
        sender: '0xsender',
        result: { ok: true }
      })
    })

    it('should include the provided request id in the response', () => {
      expect(response).toEqual({
        requestId: 'rid-1',
        sender: '0xsender',
        result: { ok: true }
      })
    })
  })

  describe('and creating a fulfilled request record', () => {
    let record: StorageRequest

    beforeEach(() => {
      record = requestOperations.toFulfilledRequestRecord({
        requestId: 'rid-1',
        expiration: new Date(1000)
      })
    })

    it('should mark the request as fulfilled with an empty payload', () => {
      expect(record).toEqual({
        requestId: 'rid-1',
        fulfilled: true,
        expiration: new Date(1000),
        code: 0,
        method: '',
        params: [],
        requiresValidation: false
      })
    })
  })

  describe('and creating a polling outcome record', () => {
    let request: StorageRequest
    let record: StorageRequest

    beforeEach(() => {
      request = {
        requestId: 'rid-1',
        method: 'method',
        params: [],
        expiration: new Date(1000),
        code: 10,
        requiresValidation: false
      }

      record = requestOperations.toPollingOutcomeRecord(request, {
        requestId: 'rid-1',
        sender: '0xsender',
        result: 'ok'
      })
    })

    it('should append the response payload to the request', () => {
      expect(record).toEqual({
        ...request,
        response: {
          requestId: 'rid-1',
          sender: '0xsender',
          result: 'ok'
        }
      })
    })
  })
})
