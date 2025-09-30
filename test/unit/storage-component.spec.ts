import { AuthIdentity } from '@dcl/crypto'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IStorageComponent } from '../../src/ports/storage/types'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

describe('when testing storage component', () => {
  let storage: IStorageComponent
  let validAuthIdentity: AuthIdentity
  let identityId: string

  beforeEach(async () => {
    storage = createStorageComponent()

    identityId = generateRandomIdentityId()

    const testIdentity = await createTestIdentity()
    validAuthIdentity = testIdentity.authChain
  })

  describe('when storing identity IDs', () => {
    describe('and the identity ID is valid', () => {
      let expiration: Date
      let createdAt: Date

      beforeEach(() => {
        expiration = new Date(Date.now() + 60000)
        createdAt = new Date()
      })

      it('should store the identity successfully', () => {
        storage.setIdentityId(identityId, {
          identityId,
          identity: validAuthIdentity,
          expiration,
          createdAt
        })

        const storedIdentity = storage.getIdentityId(identityId)
        expect(storedIdentity).not.toBeNull()
        expect(storedIdentity?.identityId).toBe(identityId)
        expect(storedIdentity?.identity).toEqual(validAuthIdentity)
        expect(storedIdentity?.expiration).toEqual(expiration)
        expect(storedIdentity?.createdAt).toEqual(createdAt)
      })
    })

    describe('and the identity ID does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should return undefined when getting non-existent identity', () => {
        const result = storage.getIdentityId(nonExistentId)
        expect(result).toBeNull()
      })
    })
  })

  describe('when deleting identity IDs', () => {
    describe('and the identity ID exists', () => {
      let expiration: Date
      let createdAt: Date

      beforeEach(() => {
        expiration = new Date(Date.now() + 60000)
        createdAt = new Date()
      })

      it('should delete the identity successfully', () => {
        // First store the identity
        storage.setIdentityId(identityId, {
          identityId,
          identity: validAuthIdentity,
          expiration,
          createdAt
        })

        // Verify it exists
        expect(storage.getIdentityId(identityId)).toBeDefined()

        // Delete it
        storage.deleteIdentityId(identityId)

        // Verify it's gone
        expect(storage.getIdentityId(identityId)).toBeNull()
      })
    })

    describe('and the identity ID does not exist', () => {
      let nonExistentId: string

      beforeEach(() => {
        nonExistentId = generateRandomIdentityId()
      })

      it('should handle deletion gracefully', () => {
        // Should not throw an error
        expect(() => storage.deleteIdentityId(nonExistentId)).not.toThrow()
      })
    })
  })

  describe('when cleaning up expired identity IDs', () => {
    describe('and there are expired identities', () => {
      let expiredIdentityId: string
      let validIdentityId: string
      let expiredExpiration: Date
      let validExpiration: Date
      let createdAt: Date

      beforeEach(() => {
        expiredIdentityId = generateRandomIdentityId()
        validIdentityId = generateRandomIdentityId()
        expiredExpiration = new Date(Date.now() - 60000) // 1 minute ago
        validExpiration = new Date(Date.now() + 60000) // 1 minute from now
        createdAt = new Date()
      })

      it('should remove expired identities', () => {
        // Store expired identity
        storage.setIdentityId(expiredIdentityId, {
          identityId: expiredIdentityId,
          identity: validAuthIdentity,
          expiration: expiredExpiration,
          createdAt
        })

        // Store valid identity
        storage.setIdentityId(validIdentityId, {
          identityId: validIdentityId,
          identity: validAuthIdentity,
          expiration: validExpiration,
          createdAt
        })

        // Verify both exist
        expect(storage.getIdentityId(expiredIdentityId)).toBeDefined()
        expect(storage.getIdentityId(validIdentityId)).toBeDefined()

        // Clean up expired identities
        storage.deleteExpiredIdentityId()

        // Verify expired identity is gone, valid identity remains
        expect(storage.getIdentityId(expiredIdentityId)).toBeNull()
        expect(storage.getIdentityId(validIdentityId)).toBeDefined()
      })
    })

    describe('and there are no expired identities', () => {
      let validIdentityId: string
      let validExpiration: Date
      let createdAt: Date

      beforeEach(() => {
        validIdentityId = generateRandomIdentityId()
        validExpiration = new Date(Date.now() + 60000) // 1 minute from now
        createdAt = new Date()
      })

      it('should not remove any identities', () => {
        // Store valid identity
        storage.setIdentityId(validIdentityId, {
          identityId: validIdentityId,
          identity: validAuthIdentity,
          expiration: validExpiration,
          createdAt
        })

        // Verify it exists
        expect(storage.getIdentityId(validIdentityId)).toBeDefined()

        // Clean up expired identities
        storage.deleteExpiredIdentityId()

        // Verify it still exists
        expect(storage.getIdentityId(validIdentityId)).toBeDefined()
      })
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
        storage.setIdentityId(identityId1, {
          identityId: identityId1,
          identity: validAuthIdentity,
          expiration: expiration1,
          createdAt
        })

        storage.setIdentityId(identityId2, {
          identityId: identityId2,
          identity: validAuthIdentity,
          expiration: expiration2,
          createdAt
        })

        storage.setIdentityId(identityId3, {
          identityId: identityId3,
          identity: validAuthIdentity,
          expiration: expiration3,
          createdAt
        })

        // Verify all exist
        expect(storage.getIdentityId(identityId1)).toBeDefined()
        expect(storage.getIdentityId(identityId2)).toBeDefined()
        expect(storage.getIdentityId(identityId3)).toBeDefined()

        // Verify they have correct expirations
        expect(storage.getIdentityId(identityId1)?.expiration).toEqual(expiration1)
        expect(storage.getIdentityId(identityId2)?.expiration).toEqual(expiration2)
        expect(storage.getIdentityId(identityId3)?.expiration).toEqual(expiration3)
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
        storage.setIdentityId(identityId1, {
          identityId: identityId1,
          identity: validAuthIdentity,
          expiration,
          createdAt
        })

        storage.setIdentityId(identityId2, {
          identityId: identityId2,
          identity: validAuthIdentity,
          expiration,
          createdAt
        })

        // Verify both exist
        expect(storage.getIdentityId(identityId1)).toBeDefined()
        expect(storage.getIdentityId(identityId2)).toBeDefined()

        // Delete one
        storage.deleteIdentityId(identityId1)

        // Verify one is gone, other remains
        expect(storage.getIdentityId(identityId1)).toBeNull()
        expect(storage.getIdentityId(identityId2)).toBeDefined()
      })
    })
  })
})
