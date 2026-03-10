import type { AuthIdentity } from '@dcl/crypto'
import { getIdentityHandler } from '../../src/controllers/handlers/identity-handlers/get-identity-handler'
import type { IStorageComponent, StorageIdentity } from '../../src/ports/storage/types'
import type { IIdentityOperationsComponent, IIpUtilsComponent, AppComponents } from '../../src/types/components'
import { generateRandomIdentityId } from '../utils/test-identity'

describe('when calling getIdentityHandler', () => {
  let storage: jest.Mocked<Pick<IStorageComponent, 'getIdentity' | 'deleteIdentity'>>
  let identityOperations: jest.Mocked<Pick<IIdentityOperationsComponent, 'isIdentityExpired' | 'validateIdentityIpAccess'>>
  let ipUtils: jest.Mocked<Pick<IIpUtilsComponent, 'getIpHeaders' | 'getClientIp' | 'ipsMatch' | 'formatIpHeaders'>>
  let logs: AppComponents['logs']
  let httpRequest: object

  const validIdentityId = generateRandomIdentityId()

  const storedIdentity: StorageIdentity = {
    identityId: validIdentityId,
    identity: {} as AuthIdentity,
    expiration: new Date(9999999999999),
    createdAt: new Date(),
    ipAddress: '1.2.3.4',
    isMobile: false
  }

  beforeEach(() => {
    logs = { getLogger: jest.fn().mockReturnValue({ log: jest.fn(), error: jest.fn() }) } as unknown as AppComponents['logs']

    storage = {
      getIdentity: jest.fn(),
      deleteIdentity: jest.fn().mockResolvedValue(undefined)
    }

    identityOperations = {
      isIdentityExpired: jest.fn().mockReturnValue(false),
      validateIdentityIpAccess: jest.fn().mockReturnValue({ ok: true, mobileMismatch: false })
    }

    ipUtils = {
      getIpHeaders: jest.fn().mockReturnValue({}),
      getClientIp: jest.fn().mockReturnValue('1.2.3.4'),
      ipsMatch: jest.fn().mockReturnValue(true),
      formatIpHeaders: jest.fn().mockReturnValue('')
    }

    httpRequest = {}
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = (identityId = validIdentityId) =>
    getIdentityHandler({
      components: { identityOperations, ipUtils, logs, storage },
      params: { id: identityId },
      request: httpRequest
    } as unknown as Parameters<typeof getIdentityHandler>[0])

  describe('and the identity id has an invalid format', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      result = await callHandler('not-a-valid-uuid')
    })

    it('should return 400', () => {
      expect(result.status).toBe(400)
    })
  })

  describe('and the identity does not exist in storage', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getIdentity.mockResolvedValueOnce(null)
      result = await callHandler()
    })

    it('should return 404', () => {
      expect(result.status).toBe(404)
    })
  })

  describe('and the identity has expired', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getIdentity.mockResolvedValueOnce(storedIdentity)
      identityOperations.isIdentityExpired.mockReturnValueOnce(true)
      result = await callHandler()
    })

    it('should return 410', () => {
      expect(result.status).toBe(410)
    })

    it('should delete the expired identity', () => {
      expect(storage.deleteIdentity).toHaveBeenCalledWith(validIdentityId)
    })
  })

  describe('and the request comes from a different IP', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getIdentity.mockResolvedValueOnce(storedIdentity)
      identityOperations.validateIdentityIpAccess.mockReturnValueOnce({ ok: false, error: 'IP address mismatch' })
      result = await callHandler()
    })

    it('should return 403', () => {
      expect(result.status).toBe(403)
    })

    it('should delete the identity on IP mismatch', () => {
      expect(storage.deleteIdentity).toHaveBeenCalledWith(validIdentityId)
    })
  })

  describe('and the identity exists and the IP matches', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      storage.getIdentity.mockResolvedValueOnce(storedIdentity)
      result = await callHandler()
    })

    it('should return 200', () => {
      expect(result.status).toBe(200)
    })

    it('should delete the identity after serving it', () => {
      expect(storage.deleteIdentity).toHaveBeenCalledWith(validIdentityId)
    })

    it('should return the AuthIdentity in the body', () => {
      expect(result.body).toEqual({ identity: storedIdentity.identity })
    })
  })
})
