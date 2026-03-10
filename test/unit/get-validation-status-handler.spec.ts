import { getValidationStatusHandler } from '../../src/controllers/handlers/request-handlers/get-validation-status-handler'
import type { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import type { IRequestOperationsComponent } from '../../src/types/components'

describe('when calling getValidationStatusHandler', () => {
  let storage: jest.Mocked<Pick<IStorageComponent, 'getRequest' | 'deleteRequest'>>
  let requestOperations: jest.Mocked<Pick<IRequestOperationsComponent, 'isRequestExpired'>>

  const baseRequest: StorageRequest = {
    requestId: 'rid-1',
    method: 'eth_sign',
    params: [],
    expiration: new Date(9999999999999),
    code: 42,
    requiresValidation: false
  }

  beforeEach(() => {
    storage = {
      getRequest: jest.fn(),
      deleteRequest: jest.fn().mockResolvedValue(undefined)
    }

    requestOperations = {
      isRequestExpired: jest.fn().mockReturnValue(false)
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = () =>
    getValidationStatusHandler({
      components: { requestOperations, storage },
      params: { requestId: 'rid-1' }
    } as unknown as Parameters<typeof getValidationStatusHandler>[0])

  describe('and the request does not exist in storage', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce(null)
      result = await callHandler()
    })

    it('should return 404', () => {
      expect(result.status).toBe(404)
    })
  })

  describe('and the request has already been fulfilled', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce({ ...baseRequest, fulfilled: true })
      result = await callHandler()
    })

    it('should return 410', () => {
      expect(result.status).toBe(410)
    })
  })

  describe('and the request has expired', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce(baseRequest)
      requestOperations.isRequestExpired.mockReturnValueOnce(true)
      result = await callHandler()
    })

    it('should return 410', () => {
      expect(result.status).toBe(410)
    })

    it('should delete the expired request', () => {
      expect(storage.deleteRequest).toHaveBeenCalledWith('rid-1')
    })
  })

  describe('and the request does not require validation', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce({ ...baseRequest, requiresValidation: false })
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should return requiresValidation as false', () => {
      expect(result.body).toEqual({ requiresValidation: false })
    })
  })

  describe('and the request requires validation', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce({ ...baseRequest, requiresValidation: true })
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should return requiresValidation as true', () => {
      expect(result.body).toEqual({ requiresValidation: true })
    })
  })
})
