import { getRequestHandler } from '../../src/controllers/handlers/request-handlers/get-request-handler'
import type { RecoverResponseMessage } from '../../src/ports/server/types'
import type { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import type { IRequestOperationsComponent } from '../../src/types/components'

describe('when calling getRequestHandler', () => {
  let storage: jest.Mocked<Pick<IStorageComponent, 'getRequest' | 'deleteRequest'>>
  let requestOperations: jest.Mocked<Pick<IRequestOperationsComponent, 'isRequestExpired' | 'toRecoverResponse'>>

  const baseRequest: StorageRequest = {
    requestId: 'rid-1',
    method: 'eth_sign',
    params: [],
    expiration: new Date(9999999999999),
    code: 42,
    requiresValidation: false
  }

  const recoverResponse: RecoverResponseMessage = {
    method: 'eth_sign',
    params: [],
    expiration: baseRequest.expiration,
    code: 42
  }

  beforeEach(() => {
    storage = {
      getRequest: jest.fn(),
      deleteRequest: jest.fn().mockResolvedValue(undefined)
    }

    requestOperations = {
      isRequestExpired: jest.fn().mockReturnValue(false),
      toRecoverResponse: jest.fn().mockReturnValue(recoverResponse)
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = () =>
    getRequestHandler({
      components: { requestOperations, storage },
      params: { requestId: 'rid-1' }
    } as unknown as Parameters<typeof getRequestHandler>[0])

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

  describe('and the request exists and is valid', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce(baseRequest)
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should return the recover response body', () => {
      expect(result.body).toEqual(recoverResponse)
    })
  })
})
