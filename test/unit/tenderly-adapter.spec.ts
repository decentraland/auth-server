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
import { createMockLogs } from '../mocks'

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
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          transaction: {
            status: true,
            error_info: null,
            transaction_info: {
              asset_changes: [{ type: 'Transfer', token_info: { standard: 'ERC20' } }],
              exposure_changes: [{ contract_address: '0xabc' }],
              balance_changes: [{ address: '0xAbCdEf0000000000000000000000000000000001', dollar_value: '12.34' }],
              logs: [{ name: 'Transfer', raw: { address: '0xDEAD', topics: ['0x01'], data: '0x' } }, { other: true }]
            }
          }
        })
      })
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

    it('should map the response into the narrowed simulation result', async () => {
      const result = await adapter.simulate(params)

      expect(result).toEqual({
        status: true,
        errorMessage: null,
        assetChanges: [{ type: 'Transfer', token_info: { standard: 'ERC20' } }],
        exposureChanges: [{ contract_address: '0xabc' }],
        rawLogs: [{ address: '0xDEAD', topics: ['0x01'], data: '0x' }],
        balanceChanges: [{ address: '0xabcdef0000000000000000000000000000000001', dollarValue: '12.34' }],
        events: [{ name: 'Transfer', address: '0xdead' }]
      })
    })

    it('should map the net balance changes with lowercased addresses and stringified dollar values', async () => {
      const result = await adapter.simulate(params)

      expect(result.balanceChanges).toEqual([{ address: '0xabcdef0000000000000000000000000000000001', dollarValue: '12.34' }])
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

  describe('and Tenderly reports a balance change without a dollar value', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          transaction: {
            status: true,
            error_info: null,
            transaction_info: {
              balance_changes: [{ address: '0xFEED' }],
              logs: []
            }
          }
        })
      })
    })

    it('should map the balance change with a null dollar value and lowercased address', async () => {
      const result = await adapter.simulate(params)

      expect(result.balanceChanges).toEqual([{ address: '0xfeed', dollarValue: null }])
    })
  })

  describe('and Tenderly reports a log without a decoded name', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          transaction: {
            status: true,
            error_info: null,
            transaction_info: {
              logs: [{ raw: { address: '0xBEEF', topics: [], data: '0x' } }]
            }
          }
        })
      })
    })

    it('should map the event with a null name and lowercased address', async () => {
      const result = await adapter.simulate(params)

      expect(result.events).toEqual([{ name: null, address: '0xbeef' }])
    })
  })

  describe('and Tenderly responds with 200 but a top-level error object', () => {
    let bodyCancel: jest.Mock

    beforeEach(() => {
      bodyCancel = jest.fn().mockResolvedValue(undefined)
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        body: { cancel: bodyCancel },
        json: async () => ({ error: { slug: 'invalid_transaction_simulation', message: 'Invalid input' }, transaction: null })
      })
    })

    it('should throw a TenderlyBadRequestError with the upstream message', async () => {
      await expect(adapter.simulate(params)).rejects.toThrow(TenderlyBadRequestError)
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
})
