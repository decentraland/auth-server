import { submitOutcomeHandler } from '../../src/controllers/handlers/request-handlers/submit-outcome-handler'
import type { OutcomeResponseMessage } from '../../src/ports/server/types'
import type { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import type { IRequestOperationsComponent, AppComponents } from '../../src/types/components'

describe('when calling submitOutcomeHandler', () => {
  let storage: jest.Mocked<Pick<IStorageComponent, 'getRequest' | 'setRequest' | 'deleteRequest'>>
  let requestOperations: jest.Mocked<Pick<IRequestOperationsComponent, 'isRequestExpired' | 'toOutcomeResponse' | 'toPollingOutcomeRecord'>>
  let logs: AppComponents['logs']
  let httpRequest: { json: jest.Mock }

  const validOutcomeBody = {
    sender: '0xaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA',
    result: { success: true }
  }

  const baseRequest: StorageRequest = {
    requestId: 'rid-1',
    method: 'eth_sign',
    params: [],
    expiration: new Date(9999999999999),
    code: 42,
    requiresValidation: false
  }

  const outcomeResponse: OutcomeResponseMessage = {
    requestId: 'rid-1',
    sender: validOutcomeBody.sender,
    result: validOutcomeBody.result
  }

  const updatedRecord: StorageRequest = { ...baseRequest, response: outcomeResponse }

  beforeEach(() => {
    logs = { getLogger: jest.fn().mockReturnValue({ log: jest.fn(), error: jest.fn() }) } as unknown as AppComponents['logs']

    storage = {
      getRequest: jest.fn(),
      setRequest: jest.fn().mockResolvedValue(undefined),
      deleteRequest: jest.fn().mockResolvedValue(undefined)
    }

    requestOperations = {
      isRequestExpired: jest.fn().mockReturnValue(false),
      toOutcomeResponse: jest.fn().mockReturnValue(outcomeResponse),
      toPollingOutcomeRecord: jest.fn().mockReturnValue(updatedRecord)
    }

    httpRequest = { json: jest.fn().mockResolvedValue(validOutcomeBody) }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = () =>
    submitOutcomeHandler({
      components: { logs, requestOperations, storage },
      params: { requestId: 'rid-1' },
      request: httpRequest
    } as unknown as Parameters<typeof submitOutcomeHandler>[0])

  describe('and the request body is invalid', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      httpRequest.json.mockResolvedValueOnce({})
      result = await callHandler()
    })

    it('should return 400', () => {
      expect(result.status).toBe(400)
    })
  })

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

  describe('and the request already has a response', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce({ ...baseRequest, response: outcomeResponse })
      result = await callHandler()
    })

    it('should return 400', () => {
      expect(result.status).toBe(400)
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

  describe('and the outcome is valid and the request is active', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getRequest.mockResolvedValueOnce(baseRequest)
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should persist the outcome to storage', () => {
      expect(storage.setRequest).toHaveBeenCalledWith('rid-1', updatedRecord)
    })
  })
})
