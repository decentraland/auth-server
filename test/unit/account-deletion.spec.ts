import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { IMagicAdapter, MagicRateLimitError } from '../../src/adapters/magic'
import { createAccountDeletionComponent } from '../../src/logic/account-deletion/component'
import { AddressMismatchError, DidTokenReusedError, DidTokenStaleError } from '../../src/logic/account-deletion/errors'
import { IAccountDeletionComponent } from '../../src/logic/account-deletion/types'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IStorageComponent } from '../../src/ports/storage/types'
import { createMockLogs } from '../mocks'

describe('when deleting an account', () => {
  let accountDeletion: IAccountDeletionComponent
  let magic: jest.Mocked<Pick<IMagicAdapter, 'validateDidToken' | 'requestUserDeletion'>>
  let storage: IStorageComponent
  let address: string
  let signedFetchAddress: string
  let didToken: string
  let tid: string
  let nowSeconds: number

  beforeEach(() => {
    address = '0xaabbccddeeff00112233445566778899aabbccdd'
    // Same address as `address` but checksum-cased, to exercise case-insensitive matching.
    signedFetchAddress = '0xAABBCCDDEEFF00112233445566778899AABBCCDD'
    nowSeconds = Math.floor(Date.now() / 1000)
    tid = 'tid-abc'
    didToken = 'did-token'

    magic = {
      validateDidToken: jest.fn(),
      requestUserDeletion: jest.fn()
    }
    storage = createStorageComponent({ cache: createInMemoryCacheComponent() })

    accountDeletion = createAccountDeletionComponent({
      magic: magic as unknown as IMagicAdapter,
      storage,
      logs: createMockLogs(),
      didTokenMaxAgeSeconds: 120
    })
  })

  describe('and the DID token is valid and matches the signer', () => {
    beforeEach(() => {
      magic.validateDidToken.mockReturnValue({ address, issuer: `did:ethr:${address}`, iat: nowSeconds, tid })
      magic.requestUserDeletion.mockResolvedValue({ processed: [address], unprocessed: [] })
    })

    it('should request the deletion from Magic with the recovered address', async () => {
      await accountDeletion.deleteAccount({ signedFetchAddress, didToken })

      expect(magic.requestUserDeletion).toHaveBeenCalledWith(address)
    })

    it('should resolve with the address and the Magic result', async () => {
      const result = await accountDeletion.deleteAccount({ signedFetchAddress, didToken })

      expect(result).toEqual({ address, magic: { processed: [address], unprocessed: [] } })
    })
  })

  describe('and the DID token address does not match the signer', () => {
    beforeEach(() => {
      magic.validateDidToken.mockReturnValue({
        address: '0x1111111111111111111111111111111111111111',
        issuer: 'did:ethr:0x1111111111111111111111111111111111111111',
        iat: nowSeconds,
        tid
      })
    })

    it('should throw an AddressMismatchError', async () => {
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(AddressMismatchError)
    })

    it('should not request the deletion from Magic', async () => {
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(AddressMismatchError)

      expect(magic.requestUserDeletion).not.toHaveBeenCalled()
    })
  })

  describe('and the DID token is stale', () => {
    beforeEach(() => {
      magic.validateDidToken.mockReturnValue({ address, issuer: `did:ethr:${address}`, iat: nowSeconds - 1000, tid })
    })

    it('should throw a DidTokenStaleError', async () => {
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(DidTokenStaleError)
    })

    it('should not request the deletion from Magic', async () => {
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(DidTokenStaleError)

      expect(magic.requestUserDeletion).not.toHaveBeenCalled()
    })
  })

  describe('and the DID token has already been used', () => {
    beforeEach(() => {
      magic.validateDidToken.mockReturnValue({ address, issuer: `did:ethr:${address}`, iat: nowSeconds, tid })
      magic.requestUserDeletion.mockResolvedValue({ processed: [address], unprocessed: [] })
    })

    it('should throw a DidTokenReusedError on the second attempt', async () => {
      await accountDeletion.deleteAccount({ signedFetchAddress, didToken })

      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(DidTokenReusedError)
    })

    it('should request the deletion from Magic only once', async () => {
      await accountDeletion.deleteAccount({ signedFetchAddress, didToken })
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(DidTokenReusedError)

      expect(magic.requestUserDeletion).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the Magic deletion fails', () => {
    beforeEach(() => {
      magic.validateDidToken.mockReturnValue({ address, issuer: `did:ethr:${address}`, iat: nowSeconds, tid })
      magic.requestUserDeletion.mockRejectedValue(new MagicRateLimitError())
    })

    it('should propagate the Magic error', async () => {
      await expect(accountDeletion.deleteAccount({ signedFetchAddress, didToken })).rejects.toThrow(MagicRateLimitError)
    })
  })
})
