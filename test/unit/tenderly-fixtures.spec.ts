import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IConfigComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { createTenderlyAdapter } from '../../src/adapters/tenderly/component'
import { ITenderlyAdapter } from '../../src/adapters/tenderly/types'
import { createSimulationComponent } from '../../src/logic/simulation/component'
import { AssetChange, ISimulationComponent, SimulationResponseBody } from '../../src/logic/simulation/types'
import { createMockLogs } from '../mocks'

/**
 * Runs the real adapter and the real simulation component over Tenderly responses recorded from the real
 * project (see scripts/record-tenderly-fixtures.ts), so the assumptions the reconciliation makes about
 * Tenderly's rows (party spelling, quantity notation, one row per movement, how an empty result and a
 * revert are serialized) are checked against what Tenderly sends rather than against fixtures written by
 * hand. Skipped while no fixture has been recorded.
 */
type Fixture = {
  scenario: string
  expectation: string
  request: { from: string; to: string; input: string; value: string }
  httpStatus: number
  response: unknown
}

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'tenderly')
const fixtureFiles = existsSync(FIXTURES_DIR) ? readdirSync(FIXTURES_DIR).filter(file => file.endsWith('.json')) : []
const fixtures: Fixture[] = fixtureFiles.map(file => JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as Fixture)

const TRANSFER_TOPICS = new Set([
  // Transfer(address,address,uint256), TransferSingle(...), TransferBatch(...)
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
])

/** The identity of a movement: what must not appear twice. */
const movementKey = (change: AssetChange) =>
  `${change.standard}:${change.contractAddress}:${change.from}:${change.to}:${change.tokenId ?? ''}:${change.rawAmount ?? ''}`

function createConfig(): IConfigComponent {
  const values: Record<string, string> = {
    TENDERLY_ACCESS_KEY: 'recorded',
    TENDERLY_ACCOUNT_SLUG: 'recorded',
    TENDERLY_PROJECT_SLUG: 'recorded',
    TENDERLY_API_URL: 'https://api.tenderly.co'
  }
  return {
    requireString: (key: string) => Promise.resolve(values[key]),
    getString: (key: string) => Promise.resolve(values[key]),
    getNumber: () => Promise.resolve(undefined),
    requireNumber: () => Promise.reject(new Error('not used'))
  } as unknown as IConfigComponent
}

/** `describe.each` refuses an empty table, so a table is registered only when it has rows. */
function describeEach(
  table: ReadonlyArray<readonly [string, Fixture]>,
  title: string,
  body: (scenario: string, fixture: Fixture) => void
): void {
  if (table.length) describe.each(table)(title, body)
}

const allScenarios = fixtures.map(fixture => [fixture.scenario, fixture] as const)
const revertScenarios = allScenarios.filter(([scenario]) => scenario === 'revert')
const effectFreeScenarios = allScenarios.filter(([scenario]) => scenario === 'effect-free')

if (fixtures.length === 0) {
  describe.skip('when simulating with responses recorded from Tenderly', () => {
    it('should run once fixtures are recorded with `npm run fixtures:tenderly`', () => undefined)
  })
}

;(fixtures.length ? describe : describe.skip)('when simulating with responses recorded from Tenderly', () => {
  describeEach(allScenarios, 'and the scenario is %s', (_scenario, fixture) => {
    let adapter: ITenderlyAdapter
    let simulation: ISimulationComponent
    let response: SimulationResponseBody

    beforeEach(async () => {
      const fetch = {
        fetch: jest
          .fn()
          .mockResolvedValue({ ok: fixture.httpStatus === 200, status: fixture.httpStatus, json: async () => fixture.response })
      }
      adapter = await createTenderlyAdapter({ config: createConfig(), logs: createMockLogs(), fetch: fetch as unknown as IFetchComponent })
      simulation = await createSimulationComponent({ tenderly: adapter, logs: createMockLogs() }, { supportedChainIds: [137] })
      response = await simulation.simulateTransaction({
        chainId: 137,
        from: fixture.request.from,
        to: fixture.request.to,
        data: fixture.request.input,
        value: fixture.request.value
      })
    })

    it('should be read as a preview rather than refused as unavailable', () => {
      expect(['success', 'reverted']).toContain(response.status)
    })

    it('should report every movement once', () => {
      const keys = response.assetChanges.map(movementKey)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('should report a row for every movement the raw logs record', async () => {
      const raw = await adapter.simulate({
        networkId: '137',
        from: fixture.request.from,
        to: fixture.request.to,
        input: fixture.request.input,
        value: fixture.request.value
      })
      const loggedMovements = raw.rawLogs.filter(log => TRANSFER_TOPICS.has(log.topics[0]?.toLowerCase())).length
      const tokenRows = response.assetChanges.filter(change => change.standard !== 'native').length
      if (response.status === 'reverted') return
      expect(tokenRows).toBeGreaterThanOrEqual(loggedMovements)
    })

    it('should leave no Tenderly row unmatched on a contract whose movements the logs record, since that would mean the two sources describe one movement differently', async () => {
      const raw = await adapter.simulate({
        networkId: '137',
        from: fixture.request.from,
        to: fixture.request.to,
        input: fixture.request.input,
        value: fixture.request.value
      })
      if (response.status === 'reverted') return
      const loggedContracts = new Set(
        raw.rawLogs.filter(log => TRANSFER_TOPICS.has(log.topics[0]?.toLowerCase())).map(log => log.address.toLowerCase())
      )
      const rowsOnLoggedContracts = response.assetChanges.filter(
        change => change.contractAddress && loggedContracts.has(change.contractAddress)
      )
      // Every row on such a contract carries the log's decimal quantities; a Tenderly leftover would show as an
      // extra row for the same parties. The count check above plus uniqueness makes this exact.
      const loggedMovements = raw.rawLogs.filter(
        log => TRANSFER_TOPICS.has(log.topics[0]?.toLowerCase()) && loggedContracts.has(log.address.toLowerCase())
      ).length
      expect(rowsOnLoggedContracts.length).toBe(loggedMovements)
    })
  })

  describeEach(revertScenarios, 'and the recorded %s scenario', (_scenario, fixture) => {
    it('should be a reverted preview carrying a reason and no effects', async () => {
      const fetch = { fetch: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fixture.response }) }
      const adapter = await createTenderlyAdapter({
        config: createConfig(),
        logs: createMockLogs(),
        fetch: fetch as unknown as IFetchComponent
      })
      const simulation = await createSimulationComponent({ tenderly: adapter, logs: createMockLogs() }, { supportedChainIds: [137] })
      const response = await simulation.simulateTransaction({
        chainId: 137,
        from: fixture.request.from,
        to: fixture.request.to,
        data: fixture.request.input,
        value: fixture.request.value
      })
      expect(response).toMatchObject({ status: 'reverted', assetChanges: [], approvalChanges: [], balanceChanges: [], events: [] })
      expect(typeof response.error).toBe('string')
    })
  })

  describeEach(effectFreeScenarios, 'and the recorded %s scenario', (_scenario, fixture) => {
    it('should be a successful preview with nothing in it', async () => {
      const fetch = { fetch: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fixture.response }) }
      const adapter = await createTenderlyAdapter({
        config: createConfig(),
        logs: createMockLogs(),
        fetch: fetch as unknown as IFetchComponent
      })
      const simulation = await createSimulationComponent({ tenderly: adapter, logs: createMockLogs() }, { supportedChainIds: [137] })
      const response = await simulation.simulateTransaction({
        chainId: 137,
        from: fixture.request.from,
        to: fixture.request.to,
        data: fixture.request.input,
        value: fixture.request.value
      })
      expect(response).toMatchObject({ status: 'success', assetChanges: [], approvalChanges: [] })
    })
  })
})
