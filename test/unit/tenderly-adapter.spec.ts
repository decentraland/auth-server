import { IConfigComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { createTenderlyAdapter } from '../../src/adapters/tenderly/component'
import {
  TenderlyAuthError,
  TenderlyBadRequestError,
  TenderlyRateLimitError,
  TenderlyUnavailableError
} from '../../src/adapters/tenderly/errors'
import { ITenderlyAdapter, TenderlySimulateParams } from '../../src/adapters/tenderly/types'
import { createJsonResponse, createMockLogs } from '../mocks'

function createMockConfig(overrides: Record<string, string | undefined> = {}): IConfigComponent {
  const defaults: Record<string, string | undefined> = {
    TENDERLY_ACCESS_KEY: 'test-key',
    TENDERLY_ACCOUNT_SLUG: 'test-account',
    TENDERLY_PROJECT_SLUG: 'test-project',
    TENDERLY_API_URL: 'https://api.tenderly.co'
  }
  const values = { ...defaults, ...overrides }

  return {
    requireString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key])),
    getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] ?? undefined)),
    getNumber: jest.fn().mockImplementation((key: string) => Promise.resolve(key === 'TENDERLY_TIMEOUT_MS' ? 6000 : undefined)),
    requireNumber: jest.fn()
  } as unknown as IConfigComponent
}

describe('when using the Tenderly adapter', () => {
  let adapter: ITenderlyAdapter
  let fetchMock: jest.Mock
  let params: TenderlySimulateParams

  beforeEach(async () => {
    fetchMock = jest.fn()
    params = {
      networkId: '137',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      input: '0x',
      value: '0'
    }
    adapter = await createTenderlyAdapter({
      config: createMockConfig(),
      logs: createMockLogs(),
      fetch: { fetch: fetchMock } as unknown as IFetchComponent
    })
  })

  describe('and Tenderly responds with 200 and a successful transaction', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              error_info: null,
              transaction_info: {
                asset_changes: [{ type: 'Transfer', token_info: { standard: 'ERC20' } }],
                exposure_changes: [{ contract_address: '0xabc' }],
                balance_changes: [{ address: '0xAbCdEf0000000000000000000000000000000001', dollar_value: '12.34' }],
                logs: [{ name: 'Transfer', raw: { address: '0xDEAD', topics: ['0x01'], data: '0x' } }]
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should POST to the account/project simulate URL with the access key header', async () => {
      await adapter.simulate(params)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tenderly.co/api/v1/account/test-account/project/test-project/simulate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Access-Key': 'test-key', 'Content-Type': 'application/json' })
        })
      )
    })

    it('should pass the configured timeout to the fetch component so the request is actually bounded', async () => {
      await adapter.simulate(params)

      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 6000 }))
    })

    it('should map the response into the narrowed simulation result', async () => {
      const result = await adapter.simulate(params)

      expect(result).toEqual({
        status: true,
        errorMessage: null,
        assetChanges: [{ type: 'Transfer', token_info: { standard: 'ERC20' } }],
        exposureChanges: [{ contract_address: '0xabc' }],
        rawLogs: [{ address: '0xDEAD', topics: ['0x01'], data: '0x' }],
        balanceChanges: [{ address: '0xAbCdEf0000000000000000000000000000000001', dollar_value: '12.34' }],
        events: [{ name: 'Transfer', address: '0xdead' }]
      })
    })

    it('should pass the net balance changes through as reported, for the preview to normalize', async () => {
      const result = await adapter.simulate(params)

      expect(result.balanceChanges).toEqual([{ address: '0xAbCdEf0000000000000000000000000000000001', dollar_value: '12.34' }])
    })

    it('should map the decoded event names alongside the lowercased emitting address', async () => {
      const result = await adapter.simulate(params)

      expect(result.events).toEqual([{ name: 'Transfer', address: '0xdead' }])
    })

    it('should simulate with a zero gas price so the sender is not charged for gas', async () => {
      await adapter.simulate(params)

      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      expect(body.gas_price).toBe('0')
    })
  })

  describe('and Tenderly reports a balance change the preview will have to read', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              error_info: null,
              transaction_info: {
                balance_changes: [{ address: '0xFEED' }],
                logs: [],
                asset_changes: null
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should pass it through untouched, since reading a figure is not the adapter job', async () => {
      const result = await adapter.simulate(params)

      expect(result.balanceChanges).toEqual([{ address: '0xFEED' }])
    })
  })

  describe('and Tenderly reports a log without a decoded name', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              error_info: null,
              transaction_info: {
                logs: [{ raw: { address: '0xBEEF', topics: [], data: '0x' } }],
                asset_changes: null
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should map the event with a null name and lowercased address', async () => {
      const result = await adapter.simulate(params)

      expect(result.events).toEqual([{ name: null, address: '0xbeef' }])
    })
  })

  describe('and Tenderly responds with 200 but a top-level error object', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          { error: { slug: 'invalid_transaction_simulation', message: 'Invalid input' }, transaction: null },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyBadRequestError with the upstream message', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyBadRequestError)
    })
  })

  describe('and Tenderly responds with 200 but no transaction status', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              transaction_info: { asset_changes: [], exposure_changes: [], balance_changes: [], logs: [] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError instead of reporting a successful simulation with no changes', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly responds with 200 and a status but no transaction info', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(createJsonResponse({ transaction: { status: true } }, { status: 200 }))
    })

    it('should throw a TenderlyUnavailableError instead of reporting a successful simulation with no effects', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe.each([
    ['logs', null],
    ['asset_changes', 'not-an-object'],
    ['exposure_changes', 1],
    ['balance_changes', null]
  ])('and Tenderly responds with 200 but the %s collection carries an entry that is not an object', (collection, entry) => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: { asset_changes: [], exposure_changes: [], balance_changes: [], logs: [], [collection]: [entry] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError rather than crash while reading it', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe.each(['logs', 'asset_changes', 'exposure_changes', 'balance_changes'])(
    'and Tenderly responds with 200 but the %s collection is not an array',
    collection => {
      beforeEach(() => {
        fetchMock.mockResolvedValue(
          createJsonResponse(
            {
              transaction: {
                status: true,
                transaction_info: { asset_changes: [], exposure_changes: [], balance_changes: [], logs: [], [collection]: 'not-a-list' }
              }
            },
            { status: 200 }
          )
        )
      })

      it('should throw a TenderlyUnavailableError rather than read it as empty', async () => {
        await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
      })
    }
  )

  describe('and Tenderly reports its collections as null, its shape for none', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: { asset_changes: null, exposure_changes: null, balance_changes: null, logs: null }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should report a successful simulation with no effects', async () => {
      await expect(adapter.simulate(params)).resolves.toMatchObject({
        status: true,
        assetChanges: [],
        exposureChanges: [],
        rawLogs: [],
        balanceChanges: [],
        events: []
      })
    })
  })

  describe.each(['logs', 'asset_changes'])('and a successful response omits the %s collection', collection => {
    beforeEach(() => {
      const info: Record<string, unknown> = { asset_changes: null, exposure_changes: null, balance_changes: null, logs: null }
      delete info[collection]
      fetchMock.mockResolvedValue(createJsonResponse({ transaction: { status: true, transaction_info: info } }, { status: 200 }))
    })

    it('should throw a TenderlyUnavailableError, since an absent effect collection is a partial answer', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and a successful response carries an empty transaction info object', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(createJsonResponse({ transaction: { status: true, transaction_info: {} } }, { status: 200 }))
    })

    it('should throw a TenderlyUnavailableError instead of reporting a success with no effects', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and a successful response omits only the enrichment collections', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse({ transaction: { status: true, transaction_info: { logs: null, asset_changes: [] } } }, { status: 200 })
      )
    })

    it('should report a successful simulation with no effects', async () => {
      await expect(adapter.simulate(params)).resolves.toMatchObject({
        status: true,
        assetChanges: [],
        rawLogs: [],
        balanceChanges: [],
        exposureChanges: []
      })
    })
  })

  describe('and a log entry carries no raw form', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: { asset_changes: [], exposure_changes: [], balance_changes: [], logs: [{ name: 'Approval' }] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError, since an approval it may carry cannot be read', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe.each([
    ['a numeric topic', { address: '0xdead', topics: [123], data: '0x' }],
    ['a missing address', { topics: ['0x01'], data: '0x' }],
    ['non-string data', { address: '0xdead', topics: ['0x01'], data: 7 }]
  ])('and a raw log carries %s', (_label, raw) => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: { asset_changes: [], exposure_changes: [], balance_changes: [], logs: [{ name: 'Transfer', raw }] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError rather than hand the decoders a log they cannot read', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe.each([
    ['a raw amount', { raw_amount: Number.MAX_SAFE_INTEGER + 2 }],
    ['a token id', { token_id: Number.MAX_SAFE_INTEGER + 2 }]
  ])('and an asset change carries %s as a number a double cannot hold', (_label, fields) => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: { asset_changes: [{ type: 'Transfer', ...fields }], exposure_changes: [], balance_changes: [], logs: [] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError, since the parse has already rounded it', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe.each([
    ['a negative string', '-1'],
    ['an exponent string', '1e18'],
    ['a fractional string', '1.5'],
    ['an empty string', ''],
    ['a padded string', ' 12'],
    ['a string with a leading zero', '012'],
    ['a negative number', -1],
    ['a fractional number', 1.5]
  ])('and an asset change carries a raw amount that is %s', (_label, rawAmount) => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: {
                asset_changes: [{ type: 'Transfer', raw_amount: rawAmount }],
                exposure_changes: [],
                balance_changes: [],
                logs: []
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError, since it is not an unsigned integer', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and an asset change carries its quantities as strings and safe numbers', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: {
                asset_changes: [
                  { type: 'Transfer', raw_amount: '9007199254740993', token_id: 7 },
                  { type: 'Transfer', raw_amount: '0', token_id: '0x1F' }
                ],
                exposure_changes: [],
                balance_changes: [],
                logs: []
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should accept them as sent, hexadecimal included', async () => {
      await expect(adapter.simulate(params)).resolves.toMatchObject({
        assetChanges: [
          { raw_amount: '9007199254740993', token_id: 7 },
          { raw_amount: '0', token_id: '0x1F' }
        ]
      })
    })
  })

  describe('and Tenderly responds with 200 and a body that is JSON null', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(createJsonResponse(null, { status: 200 }))
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly reports a revert with a reason but omits the status field', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          { transaction: { error_info: { error_message: 'execution reverted' }, transaction_info: { logs: null } } },
          { status: 200 }
        )
      )
    })

    it('should throw a TenderlyUnavailableError, since a reason is not a status', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly reports a revert whose trace metadata is unreadable', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: false,
              error_info: { error_message: 'execution reverted' },
              transaction_info: { logs: 'junk', asset_changes: [null] }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should still read it as a reverted simulation carrying the reason, since a revert reports no effects', async () => {
      await expect(adapter.simulate(params)).resolves.toMatchObject({
        status: false,
        errorMessage: 'execution reverted',
        assetChanges: [],
        rawLogs: []
      })
    })
  })

  describe('and Tenderly reports a revert without any transaction info', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse({ transaction: { status: false, error_info: { error_message: 'execution reverted' } } }, { status: 200 })
      )
    })

    it('should read it as a reverted simulation with no effects', async () => {
      await expect(adapter.simulate(params)).resolves.toMatchObject({
        status: false,
        errorMessage: 'execution reverted',
        assetChanges: [],
        rawLogs: []
      })
    })
  })

  describe('and Tenderly responds with 200 but no transaction at all', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(createJsonResponse({ simulation: { id: 'abc' } }, { status: 200 }))
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly responds with 401', () => {
    let bodyCancel: jest.Mock

    beforeEach(() => {
      bodyCancel = jest.fn().mockResolvedValue(undefined)
      fetchMock.mockResolvedValue({ ok: false, status: 401, body: { cancel: bodyCancel } })
    })

    it('should throw a TenderlyAuthError', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyAuthError)
    })

    it('should cancel the response body before throwing', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyAuthError)
      expect(bodyCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('and Tenderly responds with 400', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, body: { cancel: jest.fn().mockResolvedValue(undefined) } })
    })

    it('should throw a TenderlyBadRequestError', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyBadRequestError)
    })
  })

  describe('and Tenderly responds with a status this adapter does not expect', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: false, status: 418, body: { cancel: jest.fn().mockResolvedValue(undefined) } })
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly responds with 200 and a body that is not JSON', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(createJsonResponse(null, { status: 200, text: '<html>gateway</html>' }))
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
    })
  })

  describe('and Tenderly responds with 429', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, body: { cancel: jest.fn().mockResolvedValue(undefined) } })
    })

    it('should throw a TenderlyRateLimitError', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyRateLimitError)
    })
  })

  describe('and Tenderly responds with 500', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, body: { cancel: jest.fn().mockResolvedValue(undefined) } })
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyUnavailableError)
    })
  })

  describe('and the request is aborted by the timeout', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))
    })

    it('should throw a TenderlyUnavailableError', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyUnavailableError)
    })
  })
  describe('and the response carries more logs than a preview can report', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: {
                asset_changes: [],
                logs: Array.from({ length: 513 }, (_, index) => ({
                  name: 'Transfer',
                  raw: { address: `0x${index.toString(16).padStart(40, '0')}`, topics: ['0x01'], data: '0x' }
                }))
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should refuse the response rather than read a prefix of the effects', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyUnavailableError)
      await expect(adapter.simulate(params)).rejects.toThrow('more than a preview can report')
    })
  })

  describe.each([['asset_changes'], ['exposure_changes'], ['balance_changes']])(
    'and the response carries more %s entries than a preview can report',
    collection => {
      beforeEach(() => {
        fetchMock.mockResolvedValue(
          createJsonResponse(
            {
              transaction: {
                status: true,
                transaction_info: {
                  asset_changes: [],
                  logs: [],
                  [collection]: Array.from({ length: 513 }, () => ({}))
                }
              }
            },
            { status: 200 }
          )
        )
      })

      it('should refuse the response, since no collection a preview is built from may be read short', async () => {
        await expect(adapter.simulate(params)).rejects.toThrow(TenderlyUnavailableError)
        await expect(adapter.simulate(params)).rejects.toThrow('more than a preview can report')
      })
    }
  )

  describe('and the response carries exactly as many entries as a preview can report', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse(
          {
            transaction: {
              status: true,
              transaction_info: {
                asset_changes: [],
                logs: Array.from({ length: 512 }, (_, index) => ({
                  name: 'Transfer',
                  raw: { address: `0x${index.toString(16).padStart(40, '0')}`, topics: ['0x01'], data: '0x' }
                }))
              }
            }
          },
          { status: 200 }
        )
      )
    })

    it('should accept it and report every event, since nothing is truncated', async () => {
      const result = await adapter.simulate(params)

      expect(result.events).toHaveLength(512)
      expect(result.rawLogs).toHaveLength(512)
    })
  })
  describe('and the response announces a body larger than one a preview can be built from', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(
        createJsonResponse({ transaction: { status: true } }, { status: 200, contentLength: 8 * 1024 * 1024 + 1 })
      )
    })

    it('should refuse it on the declared length, since parsing the body is the work the bound exists to stop', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
      await expect(adapter.simulate(params)).rejects.toThrow('larger than')
    })
  })

  describe('and the response streams more than a preview can be built from without announcing a length', () => {
    beforeEach(() => {
      // No content-length, so only the running byte count can stop it — the case an upstream using
      // chunked transfer actually produces.
      const oversized = `{"padding":"${'x'.repeat(8 * 1024 * 1024 + 16)}"}`
      fetchMock.mockResolvedValue(createJsonResponse(null, { status: 200, text: oversized }))
    })

    it('should refuse it once the bound is passed rather than buffer the whole body', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
      await expect(adapter.simulate(params)).rejects.toThrow('larger than')
    })
  })

  describe('and a body just under the bound arrives', () => {
    beforeEach(() => {
      const padded = JSON.stringify({
        transaction: { status: true, transaction_info: { logs: [], asset_changes: [] }, padding: 'x'.repeat(1024) }
      })
      fetchMock.mockResolvedValue(createJsonResponse(null, { status: 200, text: padded }))
    })

    it('should read it whole and report the preview', async () => {
      const result = await adapter.simulate(params)

      expect(result.status).toBe(true)
    })
  })

  describe('and the response has no readable body', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers() } as unknown as Response)
    })

    it('should refuse it rather than read it by a route the bound does not cover', async () => {
      await expect(adapter.simulate(params)).rejects.toBeInstanceOf(TenderlyUnavailableError)
      await expect(adapter.simulate(params)).rejects.toThrow('cannot be read')
    })
  })
})
