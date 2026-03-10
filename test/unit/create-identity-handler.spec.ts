import type { AuthIdentity } from '@dcl/crypto'
import { createIdentityHandler } from '../../src/controllers/handlers/identity-handlers/create-identity-handler'
import { EphemeralAddressMismatchError, EphemeralKeyExpiredError } from '../../src/logic/errors'
import type { IStorageComponent, StorageIdentity } from '../../src/ports/storage/types'
import type { IAuthChainComponent, IIdentityOperationsComponent, IIpUtilsComponent, AppComponents } from '../../src/types/components'

describe('when calling createIdentityHandler', () => {
  let authChain: jest.Mocked<IAuthChainComponent>
  let identityOperations: jest.Mocked<Pick<IIdentityOperationsComponent, 'validateIdentityChain' | 'buildStorageIdentity'>>
  let ipUtils: jest.Mocked<Pick<IIpUtilsComponent, 'getIpHeaders' | 'getClientIp'>>
  let storage: jest.Mocked<Pick<IStorageComponent, 'setIdentity'>>
  let logs: AppComponents['logs']
  let httpRequest: { json: jest.Mock }

  const expiration = new Date(9999999999999)

  const validIdentityBody = {
    identity: {
      expiration: new Date(Date.now() + 60000).toISOString(),
      ephemeralIdentity: {
        address: '0x' + 'a'.repeat(40),
        privateKey: '0x' + 'a'.repeat(64),
        publicKey: '0x' + 'a'.repeat(128)
      },
      authChain: [{ type: 'SIGNER', payload: '0x' + 'a'.repeat(40), signature: '' }]
    }
  }

  const storedIdentity: StorageIdentity = {
    identityId: 'iid-1',
    identity: validIdentityBody.identity as unknown as AuthIdentity,
    expiration,
    createdAt: new Date(),
    ipAddress: '1.2.3.4',
    isMobile: false
  }

  beforeEach(() => {
    logs = { getLogger: jest.fn().mockReturnValue({ log: jest.fn(), error: jest.fn() }) } as unknown as AppComponents['logs']

    authChain = {
      validateAuthChain: jest.fn().mockResolvedValue({ sender: '0xsender', finalAuthority: '0xauthority' })
    }

    identityOperations = {
      validateIdentityChain: jest.fn().mockReturnValue('0xsender'),
      buildStorageIdentity: jest.fn().mockReturnValue(storedIdentity)
    }

    ipUtils = {
      getIpHeaders: jest.fn().mockReturnValue({}),
      getClientIp: jest.fn().mockReturnValue('1.2.3.4')
    }

    storage = {
      setIdentity: jest.fn().mockResolvedValue(undefined)
    }

    httpRequest = { json: jest.fn().mockResolvedValue(validIdentityBody) }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetAllMocks()
  })

  const callHandler = (verification?: { auth: string }) =>
    createIdentityHandler({
      components: { authChain, identityOperations, ipUtils, logs, storage },
      request: httpRequest,
      verification
    } as unknown as Parameters<typeof createIdentityHandler>[0])

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

  describe('and the ephemeral key has expired', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      authChain.validateAuthChain.mockRejectedValueOnce(new EphemeralKeyExpiredError())
      result = await callHandler()
    })

    it('should return 401', () => {
      expect(result.status).toBe(401)
    })
  })

  describe('and the ephemeral address does not match the auth chain', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      identityOperations.validateIdentityChain.mockImplementationOnce(() => {
        throw new EphemeralAddressMismatchError('0xaddr', '0xfinal')
      })
      result = await callHandler()
    })

    it('should return 403', () => {
      expect(result.status).toBe(403)
    })
  })

  describe('and the identity is valid', () => {
    let result: Awaited<ReturnType<typeof callHandler>>

    beforeEach(async () => {
      result = await callHandler({ auth: '0xsender' })
    })

    it('should return 201', () => {
      expect(result.status).toBe(201)
    })

    it('should persist the identity to storage', () => {
      expect(storage.setIdentity).toHaveBeenCalled()
    })

    it('should return identityId and expiration in the body', () => {
      expect(result.body).toMatchObject({ identityId: expect.any(String), expiration })
    })
  })
})
