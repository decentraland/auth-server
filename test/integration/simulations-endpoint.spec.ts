import { ITenderlyAdapter, TenderlySimulationResult, TenderlyUnavailableError } from '../../src/adapters/tenderly'
import { test } from '../components'

const FROM = '0x1111111111111111111111111111111111111111'
const TO = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x4444444444444444444444444444444444444444'

function successResult(overrides: Partial<TenderlySimulationResult> = {}): TenderlySimulationResult {
  return {
    status: true,
    errorMessage: null,
    assetChanges: [],
    exposureChanges: [],
    rawLogs: [],
    balanceChanges: [],
    events: [],
    ...overrides
  }
}

async function postSimulation(baseUrl: string, body: unknown, ip: string): Promise<Response> {
  return fetch(`${baseUrl}/simulations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body)
  })
}

test('when simulating a transaction via the endpoint', args => {
  let baseUrl: string
  let tenderly: jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    tenderly = args.components.tenderly as jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>
  })

  describe('and the request is valid and Tenderly returns a successful simulation', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TOKEN, data: '0xa9059cbb', value: '0' }
      tenderly.simulate.mockResolvedValue(
        successResult({
          assetChanges: [
            {
              type: 'Transfer',
              from: FROM,
              to: TO,
              amount: '2.0',
              raw_amount: '2000000000000000000',
              dollar_value: '2.00',
              token_info: {
                standard: 'ERC20',
                contract_address: TOKEN,
                symbol: 'MANA',
                name: 'Decentraland MANA',
                logo: 'https://logo.example/mana.png',
                decimals: 18
              }
            }
          ],
          balanceChanges: [{ address: FROM, dollarValue: '-2.00' }],
          events: [{ name: 'Transfer', address: TOKEN }]
        })
      )
    })

    it('should respond with 200 and the normalized simulation DTO', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.1')

      expect(response.status).toBe(200)
      const responseBody = await response.json()
      expect(responseBody).toEqual({
        status: 'success',
        assetChanges: [
          {
            type: 'transfer',
            standard: 'erc20',
            from: FROM,
            to: TO,
            amount: '2.0',
            rawAmount: '2000000000000000000',
            tokenId: null,
            contractAddress: TOKEN,
            symbol: 'MANA',
            name: 'Decentraland MANA',
            decimals: 18,
            logoUrl: 'https://logo.example/mana.png',
            dollarValue: '2.00'
          }
        ],
        approvalChanges: [],
        balanceChanges: [{ address: FROM, dollarValue: '-2.00' }],
        events: [{ name: 'Transfer', address: TOKEN }]
      })
    })
  })

  describe('and the request body has an invalid to address', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: 'not-an-address', value: '0' }
    })

    it('should respond with 400', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.2')

      expect(response.status).toBe(400)
    })
  })

  describe('and the request body is missing the chainId', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { from: FROM, to: TO, value: '0' }
    })

    it('should respond with 400', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.3')

      expect(response.status).toBe(400)
    })
  })

  describe('and the request body has an unexpected extra property', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '0', unexpected: true }
    })

    it('should respond with 400', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.4')

      expect(response.status).toBe(400)
    })
  })

  describe('and the chain id is not supported', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 999999, from: FROM, to: TO, value: '0' }
    })

    it('should respond with 400', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.5')

      expect(response.status).toBe(400)
    })
  })

  describe('and Tenderly is unavailable', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '0' }
      tenderly.simulate.mockRejectedValue(new TenderlyUnavailableError())
    })

    it('should respond with 502', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.6')

      expect(response.status).toBe(502)
    })
  })

  describe('and the per-IP rate limit is exceeded within a window', () => {
    let body: Record<string, unknown>
    let max: number

    beforeEach(async () => {
      body = { chainId: 137, from: FROM, to: TO, value: '0' }
      max = await args.components.config.requireNumber('SIMULATION_RATE_LIMIT_MAX')
      tenderly.simulate.mockResolvedValue(successResult())
    })

    it('should respond with 429 once the limit is exceeded', async () => {
      for (let i = 0; i < max; i++) {
        const allowed = await postSimulation(baseUrl, body, '203.0.113.99')
        expect(allowed.status).toBe(200)
      }

      const blocked = await postSimulation(baseUrl, body, '203.0.113.99')
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('retry-after')).not.toBeNull()
    })
  })
})
