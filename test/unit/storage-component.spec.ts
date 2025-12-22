import { AuthIdentity } from '@dcl/crypto'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IStorageComponent } from '../../src/ports/storage/types'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

let storage: IStorageComponent
let validAuthIdentity: AuthIdentity
let identityId: string

beforeEach(async () => {
  const cache = createInMemoryCacheComponent()
  storage = createStorageComponent({ cache })

  identityId = generateRandomIdentityId()

  const testIdentity = await createTestIdentity()
  validAuthIdentity = testIdentity
})

describe('when storing an identity', () => {
  let expiration: Date
  let createdAt: Date
  let ipAddress: string

  beforeEach(() => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()
    ipAddress = '127.0.0.1'
  })

  it('should not throw an error', async () => {
    await expect(
      storage.setIdentity(identityId, {
        identityId,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })
    ).resolves.not.toThrow()
  })
})

describe('when getting a stored identity', () => {
  let expiration: Date
  let createdAt: Date
  let ipAddress: string

  beforeEach(async () => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()
    ipAddress = '127.0.0.1'

    // Pre-store an identity for retrieval tests
    await storage.setIdentity(identityId, {
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt,
      ipAddress
    })
  })

  it('should return the stored data', async () => {
    const storedIdentity = await storage.getIdentity(identityId)

    expect(storedIdentity).toEqual({
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt,
      ipAddress
    })
  })
})

describe('when getting an identity that is not stored', () => {
  let nonExistentId: string

  beforeEach(() => {
    nonExistentId = generateRandomIdentityId()
  })

  it('should return null', async () => {
    const result = await storage.getIdentity(nonExistentId)
    expect(result).toBeNull()
  })
})

describe('when deleting an identity', () => {
  let expiration: Date
  let createdAt: Date
  let ipAddress: string

  beforeEach(async () => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()
    ipAddress = '127.0.0.1'

    // Pre-store an identity for deletion tests
    await storage.setIdentity(identityId, {
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt,
      ipAddress
    })
  })

  it('should remove it from the store', async () => {
    // Verify it exists before deletion
    expect(await storage.getIdentity(identityId)).toBeDefined()

    // Delete it
    await storage.deleteIdentity(identityId)

    // Verify it's gone
    expect(await storage.getIdentity(identityId)).toBeNull()
  })

  it('should handle deletion of non-existent identity gracefully', async () => {
    const nonExistentId = generateRandomIdentityId()

    // Should not throw an error when deleting non-existent identity
    await expect(storage.deleteIdentity(nonExistentId)).resolves.not.toThrow()
  })
})

describe('when managing multiple identity IDs', () => {
  describe('and storing multiple identities', () => {
    let identityId1: string
    let identityId2: string
    let identityId3: string
    let expiration1: Date
    let expiration2: Date
    let expiration3: Date
    let createdAt: Date
    let ipAddress: string

    beforeEach(() => {
      identityId1 = generateRandomIdentityId()
      identityId2 = generateRandomIdentityId()
      identityId3 = generateRandomIdentityId()
      expiration1 = new Date(Date.now() + 60000)
      expiration2 = new Date(Date.now() + 120000)
      expiration3 = new Date(Date.now() + 180000)
      createdAt = new Date()
      ipAddress = '127.0.0.1'
    })

    it('should store and retrieve each identity independently', async () => {
      // Store multiple identities
      await storage.setIdentity(identityId1, {
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration: expiration1,
        createdAt,
        ipAddress
      })

      await storage.setIdentity(identityId2, {
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration: expiration2,
        createdAt,
        ipAddress
      })

      await storage.setIdentity(identityId3, {
        identityId: identityId3,
        identity: validAuthIdentity,
        expiration: expiration3,
        createdAt,
        ipAddress
      })

      // Verify all exist and contain the correct data
      const retrievedIdentity1 = await storage.getIdentity(identityId1)
      const retrievedIdentity2 = await storage.getIdentity(identityId2)
      const retrievedIdentity3 = await storage.getIdentity(identityId3)

      expect(retrievedIdentity1).toEqual({
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration: expiration1,
        createdAt,
        ipAddress
      })

      expect(retrievedIdentity2).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration: expiration2,
        createdAt,
        ipAddress
      })

      expect(retrievedIdentity3).toEqual({
        identityId: identityId3,
        identity: validAuthIdentity,
        expiration: expiration3,
        createdAt,
        ipAddress
      })
    })
  })

  describe('and deleting one identity', () => {
    let identityId1: string
    let identityId2: string
    let expiration: Date
    let createdAt: Date
    let ipAddress: string

    beforeEach(() => {
      identityId1 = generateRandomIdentityId()
      identityId2 = generateRandomIdentityId()
      expiration = new Date(Date.now() + 60000)
      createdAt = new Date()
      ipAddress = '127.0.0.1'
    })

    it('should not affect other identities', async () => {
      // Store multiple identities
      await storage.setIdentity(identityId1, {
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })

      await storage.setIdentity(identityId2, {
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })

      // Verify both exist and contain the correct data
      expect(await storage.getIdentity(identityId1)).toEqual({
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })

      expect(await storage.getIdentity(identityId2)).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })

      // Delete one
      await storage.deleteIdentity(identityId1)

      // Verify one is gone, other remains with correct data
      expect(await storage.getIdentity(identityId1)).toBeNull()
      expect(await storage.getIdentity(identityId2)).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt,
        ipAddress
      })
    })
  })
})
