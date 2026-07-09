import { AuthIdentity } from '@dcl/crypto'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IdentityStatus, IStorageComponent, StorageIdentity } from '../../src/ports/storage/types'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

describe('when using the storage component', () => {
  let storage: IStorageComponent
  let identityId: string

  beforeEach(() => {
    storage = createStorageComponent({ cache: createInMemoryCacheComponent() })
    identityId = generateRandomIdentityId()
  })

  describe('and managing stored identities', () => {
    let validAuthIdentity: AuthIdentity
    let expiration: Date
    let createdAt: Date
    let ipAddress: string
    let identityData: StorageIdentity

    beforeEach(async () => {
      validAuthIdentity = await createTestIdentity()
      expiration = new Date(Date.now() + 60000)
      createdAt = new Date()
      ipAddress = '127.0.0.1'
      identityData = { identityId, identity: validAuthIdentity, expiration, createdAt, ipAddress }
    })

    describe('and storing an identity', () => {
      it('should resolve without throwing', async () => {
        await expect(storage.setIdentity(identityId, identityData)).resolves.not.toThrow()
      })
    })

    describe('and getting a stored identity', () => {
      beforeEach(async () => {
        await storage.setIdentity(identityId, identityData)
      })

      it('should return the stored identity', async () => {
        expect(await storage.getIdentity(identityId)).toEqual(identityData)
      })
    })

    describe('and getting an identity that was never stored', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should return null', async () => {
        expect(await storage.getIdentity(nonExistentId)).toBeNull()
      })
    })

    describe('and deleting a stored identity', () => {
      beforeEach(async () => {
        await storage.setIdentity(identityId, identityData)
      })

      it('should remove it from the store', async () => {
        expect(await storage.getIdentity(identityId)).toBeDefined()

        await storage.deleteIdentity(identityId)

        expect(await storage.getIdentity(identityId)).toBeNull()
      })
    })

    describe('and deleting an identity that was never stored', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should resolve without throwing', async () => {
        await expect(storage.deleteIdentity(nonExistentId)).resolves.not.toThrow()
      })
    })

    describe('and storing multiple identities', () => {
      let identityId1: string
      let identityId2: string
      let identityId3: string
      let identityData1: StorageIdentity
      let identityData2: StorageIdentity
      let identityData3: StorageIdentity

      beforeEach(async () => {
        identityId1 = generateRandomIdentityId()
        identityId2 = generateRandomIdentityId()
        identityId3 = generateRandomIdentityId()
        identityData1 = {
          identityId: identityId1,
          identity: validAuthIdentity,
          expiration: new Date(Date.now() + 60000),
          createdAt,
          ipAddress
        }
        identityData2 = {
          identityId: identityId2,
          identity: validAuthIdentity,
          expiration: new Date(Date.now() + 120000),
          createdAt,
          ipAddress
        }
        identityData3 = {
          identityId: identityId3,
          identity: validAuthIdentity,
          expiration: new Date(Date.now() + 180000),
          createdAt,
          ipAddress
        }
        await storage.setIdentity(identityId1, identityData1)
        await storage.setIdentity(identityId2, identityData2)
        await storage.setIdentity(identityId3, identityData3)
      })

      it('should store and retrieve each identity independently', async () => {
        expect(await storage.getIdentity(identityId1)).toEqual(identityData1)
        expect(await storage.getIdentity(identityId2)).toEqual(identityData2)
        expect(await storage.getIdentity(identityId3)).toEqual(identityData3)
      })
    })

    describe('and deleting one of several stored identities', () => {
      let identityId1: string
      let identityId2: string
      let identityData1: StorageIdentity
      let identityData2: StorageIdentity

      beforeEach(async () => {
        identityId1 = generateRandomIdentityId()
        identityId2 = generateRandomIdentityId()
        identityData1 = { identityId: identityId1, identity: validAuthIdentity, expiration, createdAt, ipAddress }
        identityData2 = { identityId: identityId2, identity: validAuthIdentity, expiration, createdAt, ipAddress }
        await storage.setIdentity(identityId1, identityData1)
        await storage.setIdentity(identityId2, identityData2)
        await storage.deleteIdentity(identityId1)
      })

      it('should remove only the deleted identity and leave the others intact', async () => {
        expect(await storage.getIdentity(identityId1)).toBeNull()
        expect(await storage.getIdentity(identityId2)).toEqual(identityData2)
      })
    })
  })

  describe('and managing identity status', () => {
    let expiration: Date
    let createdAt: Date
    let status: IdentityStatus

    beforeEach(() => {
      expiration = new Date(Date.now() + 60000)
      createdAt = new Date()
      status = {
        expiration,
        createdAt,
        consumed: false,
        signer: '0x1234567890abcdef'
      }
    })

    describe('and storing an identity status', () => {
      it('should resolve without throwing', async () => {
        await expect(storage.setIdentityStatus(identityId, status)).resolves.not.toThrow()
      })
    })

    describe('and getting a stored identity status', () => {
      beforeEach(async () => {
        await storage.setIdentityStatus(identityId, status)
      })

      it('should return the stored status', async () => {
        expect(await storage.getIdentityStatus(identityId)).toEqual(status)
      })
    })

    describe('and getting an identity status that does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should return null', async () => {
        expect(await storage.getIdentityStatus(nonExistentId)).toBeNull()
      })
    })

    describe('and updating a stored identity status', () => {
      beforeEach(async () => {
        await storage.setIdentityStatus(identityId, status)
      })

      it('should merge the updates into the existing status', async () => {
        await storage.updateIdentityStatus(identityId, { consumed: true, deletionReason: 'consumed' })

        expect(await storage.getIdentityStatus(identityId)).toEqual({ ...status, consumed: true, deletionReason: 'consumed' })
      })

      it('should preserve fields that are not part of the update', async () => {
        await storage.updateIdentityStatus(identityId, { deletionReason: 'expired' })

        expect(await storage.getIdentityStatus(identityId)).toEqual({ ...status, deletionReason: 'expired' })
      })
    })

    describe('and updating an identity status that does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should resolve without throwing', async () => {
        await expect(storage.updateIdentityStatus(nonExistentId, { consumed: true })).resolves.not.toThrow()
      })

      it('should not create a new status', async () => {
        await storage.updateIdentityStatus(nonExistentId, { consumed: true })

        expect(await storage.getIdentityStatus(nonExistentId)).toBeNull()
      })
    })
  })
})
