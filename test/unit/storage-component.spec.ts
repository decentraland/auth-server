import { AuthIdentity } from '@dcl/crypto'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IStorageComponent } from '../../src/ports/storage/types'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

let storage: IStorageComponent
let validAuthIdentity: AuthIdentity
let identityId: string

beforeEach(async () => {
  storage = createStorageComponent()

  identityId = generateRandomIdentityId()

  const testIdentity = await createTestIdentity()
  validAuthIdentity = testIdentity
})

describe('when storing an identity', () => {
  let expiration: Date
  let createdAt: Date

  beforeEach(() => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()
  })

  it('should not throw an error', () => {
    expect(() => {
      storage.setIdentity(identityId, {
        identityId,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })
    }).not.toThrow()
  })
})

describe('when getting a stored identity', () => {
  let expiration: Date
  let createdAt: Date

  beforeEach(() => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()

    // Pre-store an identity for retrieval tests
    storage.setIdentity(identityId, {
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt
    })
  })

  it('should return the stored data', () => {
    const storedIdentity = storage.getIdentity(identityId)

    expect(storedIdentity).toEqual({
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt
    })
  })
})

describe('when getting an identity that is not stored', () => {
  let nonExistentId: string

  beforeEach(() => {
    nonExistentId = generateRandomIdentityId()
  })

  it('should return null', () => {
    const result = storage.getIdentity(nonExistentId)
    expect(result).toBeNull()
  })
})

describe('when deleting an identity', () => {
  let expiration: Date
  let createdAt: Date

  beforeEach(() => {
    expiration = new Date(Date.now() + 60000)
    createdAt = new Date()

    // Pre-store an identity for deletion tests
    storage.setIdentity(identityId, {
      identityId,
      identity: validAuthIdentity,
      expiration,
      createdAt
    })
  })

  it('should remove it from the store', () => {
    // Verify it exists before deletion
    expect(storage.getIdentity(identityId)).toBeDefined()

    // Delete it
    storage.deleteIdentity(identityId)

    // Verify it's gone
    expect(storage.getIdentity(identityId)).toBeNull()
  })

  it('should handle deletion of non-existent identity gracefully', () => {
    const nonExistentId = generateRandomIdentityId()

    // Should not throw an error when deleting non-existent identity
    expect(() => storage.deleteIdentity(nonExistentId)).not.toThrow()
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

    beforeEach(() => {
      identityId1 = generateRandomIdentityId()
      identityId2 = generateRandomIdentityId()
      identityId3 = generateRandomIdentityId()
      expiration1 = new Date(Date.now() + 60000)
      expiration2 = new Date(Date.now() + 120000)
      expiration3 = new Date(Date.now() + 180000)
      createdAt = new Date()
    })

    it('should store and retrieve each identity independently', () => {
      // Store multiple identities
      storage.setIdentity(identityId1, {
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration: expiration1,
        createdAt
      })

      storage.setIdentity(identityId2, {
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration: expiration2,
        createdAt
      })

      storage.setIdentity(identityId3, {
        identityId: identityId3,
        identity: validAuthIdentity,
        expiration: expiration3,
        createdAt
      })

      // Verify all exist and contain the correct data
      const retrievedIdentity1 = storage.getIdentity(identityId1)
      const retrievedIdentity2 = storage.getIdentity(identityId2)
      const retrievedIdentity3 = storage.getIdentity(identityId3)

      expect(retrievedIdentity1).toEqual({
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration: expiration1,
        createdAt
      })

      expect(retrievedIdentity2).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration: expiration2,
        createdAt
      })

      expect(retrievedIdentity3).toEqual({
        identityId: identityId3,
        identity: validAuthIdentity,
        expiration: expiration3,
        createdAt
      })
    })
  })

  describe('and deleting one identity', () => {
    let identityId1: string
    let identityId2: string
    let expiration: Date
    let createdAt: Date

    beforeEach(() => {
      identityId1 = generateRandomIdentityId()
      identityId2 = generateRandomIdentityId()
      expiration = new Date(Date.now() + 60000)
      createdAt = new Date()
    })

    it('should not affect other identities', () => {
      // Store multiple identities
      storage.setIdentity(identityId1, {
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })

      storage.setIdentity(identityId2, {
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })

      // Verify both exist and contain the correct data
      expect(storage.getIdentity(identityId1)).toEqual({
        identityId: identityId1,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })

      expect(storage.getIdentity(identityId2)).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })

      // Delete one
      storage.deleteIdentity(identityId1)

      // Verify one is gone, other remains with correct data
      expect(storage.getIdentity(identityId1)).toBeNull()
      expect(storage.getIdentity(identityId2)).toEqual({
        identityId: identityId2,
        identity: validAuthIdentity,
        expiration,
        createdAt
      })
    })
  })
})
