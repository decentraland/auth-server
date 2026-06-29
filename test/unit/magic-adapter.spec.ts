import { Magic, SDKError, ErrorCode } from '@magic-sdk/admin'
import { IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createMagicAdapter } from '../../src/adapters/magic/component'
import {
  MagicAuthError,
  MagicDeletionError,
  MagicRateLimitError,
  MagicTokenExpiredError,
  MagicTokenInvalidError
} from '../../src/adapters/magic/errors'
import { IMagicAdapter } from '../../src/adapters/magic/types'

// Mock only the Magic class — keep the real SDKError / ErrorCode so `instanceof`
// checks and enum comparisons in the adapter work against real values.
jest.mock('@magic-sdk/admin', () => {
  const actual = jest.requireActual('@magic-sdk/admin')
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Magic: jest.fn()
  }
})

function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

function createMockConfig(overrides: Record<string, string | undefined> = {}): IConfigComponent {
  const defaults: Record<string, string | undefined> = {
    MAGIC_SECRET_KEY: 'sk_test_dummy_key',
    MAGIC_API_URL: 'https://api.magic.link',
    MAGIC_CLIENT_ID: 'test-client-id'
  }
  const values = { ...defaults, ...overrides }

  return {
    requireString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key])),
    getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] ?? undefined)),
    requireNumber: jest.fn(),
    getNumber: jest.fn()
  } as unknown as IConfigComponent
}

describe('when using the Magic adapter', () => {
  let adapter: IMagicAdapter
  let fetchMock: jest.Mock
  let tokenValidate: jest.Mock
  let tokenDecode: jest.Mock
  let tokenGetPublicAddress: jest.Mock
  let secretKey: string

  beforeEach(async () => {
    secretKey = 'sk_test_dummy_key'
    tokenValidate = jest.fn()
    tokenDecode = jest.fn()
    tokenGetPublicAddress = jest.fn()
    ;(Magic as unknown as jest.Mock).mockImplementation(() => ({
      token: { validate: tokenValidate, decode: tokenDecode, getPublicAddress: tokenGetPublicAddress }
    }))
    fetchMock = jest.fn()

    adapter = await createMagicAdapter({
      config: createMockConfig({ MAGIC_SECRET_KEY: secretKey }),
      logs: createMockLogs(),
      fetch: { fetch: fetchMock } as unknown as IFetchComponent
    })
  })

  describe('and validating a DID token', () => {
    describe('and the token is valid', () => {
      let claim: { iat: number; ext: number; iss: string; sub: string; aud: string; nbf: number; tid: string; add: string }

      beforeEach(() => {
        claim = {
          iat: 1700000000,
          ext: 1700000900,
          iss: 'did:ethr:0xAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbC0',
          sub: 'sub',
          aud: 'aud',
          nbf: 1700000000,
          tid: 'tid-123',
          add: 'none'
        }
        tokenValidate.mockReturnValue(undefined)
        tokenDecode.mockReturnValue(['proof', claim])
        tokenGetPublicAddress.mockReturnValue('0xAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbCAbC0')
      })

      it('should return the lowercased address, issuer, iat and tid', () => {
        expect(adapter.validateDidToken('valid-token')).toEqual({
          address: '0xabcabcabcabcabcabcabcabcabcabcabcabcabc0',
          issuer: claim.iss,
          iat: claim.iat,
          tid: claim.tid
        })
      })
    })

    describe('and the token is expired', () => {
      beforeEach(() => {
        tokenValidate.mockImplementation(() => {
          throw new SDKError(ErrorCode.TokenExpired, 'expired')
        })
      })

      it('should throw a MagicTokenExpiredError', () => {
        expect(() => adapter.validateDidToken('expired-token')).toThrow(MagicTokenExpiredError)
      })
    })

    describe('and the token cannot be used yet', () => {
      beforeEach(() => {
        tokenValidate.mockImplementation(() => {
          throw new SDKError(ErrorCode.TokenCannotBeUsedYet, 'nbf')
        })
      })

      it('should throw a MagicTokenExpiredError', () => {
        expect(() => adapter.validateDidToken('nbf-token')).toThrow(MagicTokenExpiredError)
      })
    })

    describe('and the signature cannot be recovered', () => {
      beforeEach(() => {
        tokenValidate.mockImplementation(() => {
          throw new SDKError(ErrorCode.FailedRecoveryProof, 'bad signature')
        })
      })

      it('should throw a MagicTokenInvalidError', () => {
        expect(() => adapter.validateDidToken('bad-token')).toThrow(MagicTokenInvalidError)
      })
    })

    describe('and a non-SDK error is thrown', () => {
      beforeEach(() => {
        tokenValidate.mockImplementation(() => {
          throw new Error('unexpected')
        })
      })

      it('should throw a MagicTokenInvalidError', () => {
        expect(() => adapter.validateDidToken('weird-token')).toThrow(MagicTokenInvalidError)
      })
    })
  })

  describe('and requesting user deletion', () => {
    let address: string

    beforeEach(() => {
      address = '0xabcabcabcabcabcabcabcabcabcabcabcabcabc0'
    })

    describe('and Magic responds with 200', () => {
      beforeEach(() => {
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ processed: [address], unprocessed: [] })
        })
      })

      it('should return the processed and unprocessed lists', async () => {
        await expect(adapter.requestUserDeletion(address)).resolves.toEqual({ processed: [address], unprocessed: [] })
      })

      it('should call Magic with the secret key header and the public_addresses body', async () => {
        await adapter.requestUserDeletion(address)

        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.magic.link/v1/admin/user/deletion/request',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'X-Magic-Secret-Key': secretKey, 'Content-Type': 'application/json' }),
            body: JSON.stringify({ public_addresses: [address] })
          })
        )
      })
    })

    describe('and Magic responds with 401', () => {
      beforeEach(() => {
        fetchMock.mockResolvedValue({ ok: false, status: 401 })
      })

      it('should throw a MagicAuthError', async () => {
        await expect(adapter.requestUserDeletion(address)).rejects.toThrow(MagicAuthError)
      })
    })

    describe('and Magic responds with 429', () => {
      beforeEach(() => {
        fetchMock.mockResolvedValue({ ok: false, status: 429 })
      })

      it('should throw a MagicRateLimitError', async () => {
        await expect(adapter.requestUserDeletion(address)).rejects.toThrow(MagicRateLimitError)
      })
    })

    describe('and Magic responds with an unexpected error', () => {
      beforeEach(() => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
      })

      it('should throw a MagicDeletionError', async () => {
        await expect(adapter.requestUserDeletion(address)).rejects.toThrow(MagicDeletionError)
      })
    })
  })
})
