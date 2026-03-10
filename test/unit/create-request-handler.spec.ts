import { createRequestHandler } from '../../src/controllers/handlers/request-handlers/create-request-handler'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import type { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import type { IAuthChainComponent, IRequestOperationsComponent, AppComponents } from '../../src/types/components'

describe('when calling createRequestHandler', () => {
  let authChain: jest.Mocked<IAuthChainComponent>
  let config: jest.Mocked<AppComponents['config']>
  let requestOperations: jest.Mocked<Pick<IRequestOperationsComponent, 'computeRequestExpiration' | 'buildRequestRecord'>>
  let storage: jest.Mocked<Pick<IStorageComponent, 'setRequest'>>
  let httpRequest: { json: jest.Mock }

  const expiration = new Date(9999999999999)

  const builtRecord: StorageRequest = {
    requestId: expect.any(String),
    method: 'personal_sign',
    params: [],
    expiration,
    code: expect.any(Number),
    requiresValidation: false
  }

  beforeEach(() => {
    authChain = {
      validateAuthChain: jest.fn().mockResolvedValue({ sender: '0xsender', finalAuthority: '0xauthority' })
    }

    config = {
      requireNumber: jest.fn().mockResolvedValue(60)
    } as unknown as jest.Mocked<AppComponents['config']>

    requestOperations = {
      computeRequestExpiration: jest.fn().mockReturnValue(expiration),
      buildRequestRecord: jest.fn().mockReturnValue(builtRecord)
    }

    storage = {
      setRequest: jest.fn().mockResolvedValue(undefined)
    }

    httpRequest = {
      json: jest.fn().mockResolvedValue({ method: 'personal_sign', params: [] })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = () =>
    createRequestHandler({
      components: { authChain, config, requestOperations, storage },
      request: httpRequest
    } as unknown as Parameters<typeof createRequestHandler>[0])

  describe('and the request body fails validation', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      httpRequest.json.mockResolvedValueOnce({})
      result = await callHandler()
    })

    it('should return 400', () => {
      expect(result.status).toBe(400)
    })
  })

  describe('and the auth chain validation fails for a non-dcl_personal_sign request', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      authChain.validateAuthChain.mockRejectedValueOnce(new Error('Invalid auth chain'))
      result = await callHandler()
    })

    it('should return 400', () => {
      expect(result.status).toBe(400)
    })
  })

  describe('and the request is a valid non-dcl_personal_sign method', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      result = await callHandler()
    })

    it('should return 201', () => {
      expect(result.status).toBe(201)
    })

    it('should validate the auth chain', () => {
      expect(authChain.validateAuthChain).toHaveBeenCalled()
    })

    it('should persist the request to storage', () => {
      expect(storage.setRequest).toHaveBeenCalled()
    })

    it('should include requestId, expiration and code in the response', () => {
      expect(result.body).toMatchObject({ requestId: expect.any(String), expiration, code: expect.any(Number) })
    })
  })

  describe('and the request method is dcl_personal_sign', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      httpRequest.json.mockResolvedValueOnce({ method: METHOD_DCL_PERSONAL_SIGN, params: ['ephemeral message'] })
      result = await callHandler()
    })

    it('should return 201', () => {
      expect(result.status).toBe(201)
    })

    it('should skip auth chain validation', () => {
      expect(authChain.validateAuthChain).not.toHaveBeenCalled()
    })

    it('should persist the request to storage', () => {
      expect(storage.setRequest).toHaveBeenCalled()
    })
  })
})
