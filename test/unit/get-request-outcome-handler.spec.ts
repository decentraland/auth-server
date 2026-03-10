import { getRequestOutcomeHandler } from '../../src/controllers/handlers/request-handlers/get-request-outcome-handler'
import type { OutcomeResponseMessage } from '../../src/ports/server/types'
import type { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import type { IRequestOperationsComponent, AppComponents } from '../../src/types/components'

describe('when calling getRequestOutcomeHandler', () => {
  let storage: jest.Mocked<Pick<IStorageComponent, 'getRequest' | 'setRequest' | 'deleteRequest'>>
  let requestOperations: jest.Mocked<Pick<IRequestOperationsComponent, 'isRequestExpired' | 'toFulfilledRequestRecord'>>
  let logs: AppComponents['logs']

  const outcomeResponse: OutcomeResponseMessage = {
    requestId: 'rid-1',
    sender: '0xsender',
    result: { ok: true }
  }

  const baseRequest: StorageRequest = {
    requestId: 'rid-1',
    method: 'eth_sign',
    params: [],
    expiration: new Date(9999999999999),
    code: 42,
    requiresValidation: false
  }

  const fulfilledTombstone: StorageRequest = {
    requestId: 'rid-1',
    fulfilled: true,
    expiration: baseRequest.expiration,
    code: 0,
    method: '',
    params: [],
    requiresValidation: false
  }

  beforeEach(() => {
    logs = { getLogger: jest.fn().mockReturnValue({ log: jest.fn(), error: jest.fn() }) } as unknown as AppComponents['logs']

    storage = {
      getRequest: jest.fn(),
      setRequest: jest.fn().mockResolvedValue(undefined),
      deleteRequest: jest.fn().mockResolvedValue(undefined)
    }

    requestOperations = {
      isRequestExpired: jest.fn().mockReturnValue(false),
      toFulfilledRequestRecord: jest.fn().mockReturnValue(fulfilledTombstone)
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = () =>
    getRequestOutcomeHandler({
      components: { logs, requestOperations, storage },
      params: { requestId: 'rid-1' }
    } as unknown as Parameters<typeof getRequestOutcomeHandler>[0])

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

    it('should return 404', () => {
      expect(result.status).toBe(404)
    })

    it('should delete the expired request', () => {
      expect(storage.deleteRequest).toHaveBeenCalledWith('rid-1')
    })
  })

  describe('and the request has no response yet', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce(baseRequest)
      result = await callHandler()
    })

    it('should return 204', () => {
      expect(result.status).toBe(204)
    })
  })

  describe('and the request has a response ready', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce({ ...baseRequest, response: outcomeResponse })
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should return the outcome in the response body', () => {
      expect(result.body).toEqual(outcomeResponse)
    })

    it('should mark the request as fulfilled', () => {
      expect(storage.setRequest).toHaveBeenCalledWith('rid-1', fulfilledTombstone)
    })
  })
})
