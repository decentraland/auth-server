import { MaxUint256, id, zeroPadValue } from 'ethers'
import { ITenderlyAdapter, TenderlyBadRequestError, TenderlySimulationResult, TenderlyUnavailableError } from '../../src/adapters/tenderly'
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

  describe('and the request carries the largest calldata the auth dapp forwards (96 KiB plus the meta-transaction sender)', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: TOKEN, to: TOKEN, data: `0xa9059cbb${'00'.repeat(96 * 1024 - 4)}${FROM.slice(2)}`, value: '0' }
      tenderly.simulate.mockResolvedValue(successResult())
    })

    it('should accept the body instead of refusing it as too large', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.9')

      expect(response.status).toBe(200)
    })
  })

  describe('and a body of the same size is posted to another route', () => {
    let body: string

    beforeEach(() => {
      body = JSON.stringify({ method: 'personal_sign', params: ['a'.repeat(20 * 1024)] })
    })

    it('should refuse it as too large, since only the simulations route carries the larger cap', async () => {
      const response = await fetch(`${baseUrl}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

      expect(response.status).toBe(413)
    })
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
          balanceChanges: [{ address: FROM, dollar_value: '-2.00' }],
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

    it('should respond with 400 saying the request itself was refused', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.2')

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid_request' })
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

  describe('and the value is above what an EVM transaction can carry', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: (MaxUint256 + 1n).toString() }
    })

    it('should respond with 400 saying the request itself was refused, without reaching the provider', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.11')

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid_request' })
      expect(tenderly.simulate).not.toHaveBeenCalled()
    })
  })

  describe('and the chain id is not supported', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 999999, from: FROM, to: TO, value: '0' }
    })

    it('should respond with 400 saying the request itself was refused', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.5')

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid_request' })
    })
  })

  describe('and Tenderly returns an Approval log that cannot be decoded', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '0' }
      tenderly.simulate.mockResolvedValue(
        successResult({
          rawLogs: [
            {
              address: TOKEN,
              topics: [id('Approval(address,address,uint256)'), zeroPadValue(FROM, 32), zeroPadValue(TO, 32)],
              data: '0x12'
            }
          ]
        })
      )
    })

    it('should respond with 502, since the effects cannot be reported completely', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.10')

      expect(response.status).toBe(502)
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

  describe('and Tenderly rejects the request as a bad request with upstream detail', () => {
    let body: Record<string, unknown>

    beforeEach(() => {
      body = { chainId: 137, from: FROM, to: TO, value: '0' }
      tenderly.simulate.mockRejectedValue(new TenderlyBadRequestError('some upstream detail'))
    })

    it('should respond with 400', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.7')

      expect(response.status).toBe(400)
    })

    it('should say the provider refused it without echoing the upstream detail, so the dapp treats it as an outage', async () => {
      const response = await postSimulation(baseUrl, body, '203.0.113.8')
      const responseBody = await response.json()

      expect(JSON.stringify(responseBody)).not.toContain('some upstream detail')
      expect(responseBody).toMatchObject({ code: 'upstream_rejected' })
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

    it('should account for the refusal as this service own quota, not as the provider rate limiting us', async () => {
      for (let i = 0; i < max; i++) {
        await postSimulation(baseUrl, body, '203.0.113.98')
      }

      const blocked = await postSimulation(baseUrl, body, '203.0.113.98')

      expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded' })
    })
  })
})

test('when the global simulation rate limit is exceeded across multiple IPs', args => {
  let baseUrl: string
  let tenderly: jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    tenderly = args.components.tenderly as jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>
  })

  describe('and the global cap has been filled by requests from several IPs each below the per-IP cap', () => {
    let body: Record<string, unknown>

    beforeEach(async () => {
      body = { chainId: 137, from: FROM, to: TO, value: '0' }
      tenderly.simulate.mockResolvedValue(successResult())

      const globalMax = await args.components.config.requireNumber('SIMULATION_RATE_LIMIT_GLOBAL_MAX')
      const perIpMax = await args.components.config.requireNumber('SIMULATION_RATE_LIMIT_MAX')

      // Fill the global bucket exactly to its cap, spreading requests across enough
      // distinct IPs that no single IP reaches the per-IP cap first.
      let sent = 0
      let ipOctet = 0
      while (sent < globalMax) {
        const inThisIp = Math.min(perIpMax, globalMax - sent)
        for (let i = 0; i < inThisIp; i++) {
          await postSimulation(baseUrl, body, `198.51.100.${ipOctet}`)
          sent++
        }
        ipOctet++
      }
    })

    it('should respond with 429 to a request from a different IP', async () => {
      const blocked = await postSimulation(baseUrl, body, '198.51.100.250')

      expect(blocked.status).toBe(429)
    })

    it('should account for the refusal as this service own quota, since the shared budget is what ran out', async () => {
      const blocked = await postSimulation(baseUrl, body, '198.51.100.251')

      expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded' })
    })
  })
})

test('when invalid simulation requests arrive in bulk', args => {
  let baseUrl: string
  let tenderly: jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
    tenderly = args.components.tenderly as jest.Mocked<Pick<ITenderlyAdapter, 'simulate'>>
  })

  describe('and more requests than the global cap were refused before reaching the provider', () => {
    let validBody: Record<string, unknown>

    beforeEach(async () => {
      validBody = { chainId: 137, from: FROM, to: TO, value: '0' }
      tenderly.simulate.mockResolvedValue(successResult())

      const globalMax = await args.components.config.requireNumber('SIMULATION_RATE_LIMIT_GLOBAL_MAX')
      const perIpMax = await args.components.config.requireNumber('SIMULATION_RATE_LIMIT_MAX')
      const invalidBodies = [
        { chainId: 999999, from: FROM, to: TO, value: '0' },
        { chainId: 137, from: 'not-an-address', to: TO, value: '0' }
      ]

      // Spread across enough IPs that none reaches the per-IP cap, so only the global cap could stop them.
      let sent = 0
      let ipOctet = 0
      while (sent <= globalMax) {
        const inThisIp = Math.min(perIpMax, globalMax + 1 - sent)
        for (let i = 0; i < inThisIp; i++) {
          await postSimulation(baseUrl, invalidBodies[sent % invalidBodies.length], `192.0.2.${ipOctet}`)
          sent++
        }
        ipOctet++
      }
    })

    it('should still simulate a valid request, since refused requests never spend the provider budget', async () => {
      const response = await postSimulation(baseUrl, validBody, '192.0.2.250')

      expect(response.status).toBe(200)
      expect(tenderly.simulate).toHaveBeenCalledTimes(1)
    })
  })
})
