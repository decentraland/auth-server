/* eslint-disable no-console */
/**
 * Records real Tenderly simulation responses as golden fixtures for the simulation tests.
 *
 * The unit specs of the simulation path feed the adapter responses written by hand, which proves the code
 * does what we think a Tenderly answer looks like, not that a Tenderly answer looks like that. This script
 * asks the real project for a handful of representative simulations and saves the raw JSON under
 * `test/fixtures/tenderly/`, where `test/unit/tenderly-fixtures.spec.ts` runs the adapter and the
 * component over each file and asserts the reconciled output. Only the fields the adapter reads are kept
 * (with the list of keys that were present next to them), so a fixture stays small and names nothing of
 * the project. Re-run it whenever Tenderly's serialization is in question; commit the files it writes.
 *
 * Two scenarios need no chain state and run with the access key alone:
 *   - `effect-free`: a call that changes nothing (`MANAToken.decimals()`), which shows how empty
 *     collections are serialized (null, empty list, or omitted).
 *   - `revert`: a MANA transfer from an address that holds none, which shows how a revert is
 *     serialized (`status: false`, the reason, what `transaction_info` carries).
 *
 * Three scenarios move assets and need an account that holds them on Polygon, given as environment
 * variables; each is skipped with a note when its variables are absent:
 *   - `mana-transfer`: FIXTURE_SENDER (holds at least 1 MANA), FIXTURE_RECIPIENT (optional).
 *   - `wearable-purchase`: FIXTURE_SENDER (holds the price in MANA and has approved OffChainMarketplaceV2)
 *     and FIXTURE_TRADE_ID, the id of an open `public_nft_order` trade on Polygon from the marketplace API
 *     (`GET https://marketplace-api.decentraland.org/v1/orders?status=open` lists them with their tradeId; the
 *     sender must not be its signer). Listings on Polygon are off-chain trades accepted through
 *     OffChainMarketplaceV2.accept, so this is the purchase path the dapp previews.
 *   - `collection-mint`: FIXTURE_SENDER (holds the price in MANA and has approved CollectionStore),
 *     FIXTURE_ITEM_COLLECTION, FIXTURE_ITEM_ID, FIXTURE_ITEM_PRICE (wei), from a collection on sale.
 *
 * Usage (the Tenderly variables are the ones the server itself reads; `.env` is read when present):
 *   TENDERLY_ACCESS_KEY=… TENDERLY_ACCOUNT_SLUG=… TENDERLY_PROJECT_SLUG=… \
 *   FIXTURE_SENDER=0x… npx ts-node scripts/record-tenderly-fixtures.ts [--dry-run] [scenario…]
 *
 * `--dry-run` builds each request (fetching the trade for the purchase) and prints it without calling Tenderly
 * or writing anything, so the inputs can be checked before spending a simulation.
 *
 * The access key is sent in a header and never written to disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Interface, ZeroAddress, zeroPadValue } from 'ethers'

const POLYGON = '137'
// Registry addresses on Polygon (decentraland-transactions), lowercased.
const MANA = '0xa1c57f48f0deb89f569dfbe6e2b7f46d33606fd4'
const OFFCHAIN_MARKETPLACE_V2 = '0xa40b1d129b8906888720686f3a01921ddf37716f'
const MARKETPLACE_API = 'https://marketplace-api.decentraland.org/v1'
const COLLECTION_STORE = '0x214ffc0f0103735728dc66b61a22e4f163e275ae'
// An address that holds nothing: the sender of the stateless scenarios.
const NOBODY = '0x000000000000000000000000000000000000dead'
const FIXTURES_DIR = join(__dirname, '..', 'test', 'fixtures', 'tenderly')

const mana = new Interface([
  'function decimals() view returns (uint8)',
  'function transfer(address recipient, uint256 amount) returns (bool)'
])
const offchainMarketplace = new Interface([
  'function accept((address signer, bytes signature, (uint256 uses, uint256 expiration, uint256 effective, bytes32 salt, uint256 contractSignatureIndex, uint256 signerSignatureIndex, bytes32 allowedRoot, bytes32[] allowedProof, (address contractAddress, bytes4 selector, bytes value, bool required)[] externalChecks) checks, (uint256 assetType, address contractAddress, uint256 value, address beneficiary, bytes extra)[] sent, (uint256 assetType, address contractAddress, uint256 value, address beneficiary, bytes extra)[] received)[] _trades)'
])

/** A trade as the marketplace API returns it (the fields `accept` needs). */
type ApiTrade = {
  id: string
  signer: string
  signature: string
  type: string
  network: string
  checks: {
    uses: number
    expiration: number
    effective: number
    salt: string
    allowedRoot: string
    contractSignatureIndex: number
    signerSignatureIndex: number
    externalChecks?: Array<{ contractAddress: string; selector: string; value?: string; required: boolean }>
  }
  sent: Array<{ assetType: number; contractAddress: string; tokenId?: string; amount?: string; itemId?: string; extra?: string }>
  received: Array<{
    assetType: number
    contractAddress: string
    tokenId?: string
    amount?: string
    itemId?: string
    extra?: string
    beneficiary: string
  }>
}

/** The `value` the struct carries for an asset: the token id, the amount or the item id (marketplace-server's getValueFromTradeAsset). */
function assetValue(asset: ApiTrade['sent'][number]): bigint {
  const value = asset.tokenId ?? asset.amount ?? asset.itemId
  if (value === undefined) throw new Error(`asset of type ${asset.assetType} carries no value`)
  return BigInt(value)
}

/**
 * The `accept` calldata for a trade, built the way marketplace-server rebuilds the signed struct to verify it:
 * salt and allowed root zero-padded to 32 bytes, timestamps in seconds, empty `extra` as `0x`. The sent side
 * carries no beneficiary in the signature; the contract fills a zero one with the caller.
 */
function acceptCalldata(trade: ApiTrade): string {
  const seconds = (milliseconds: number) => BigInt(Math.floor(milliseconds / 1000))
  const bytes32 = (value: string) => zeroPadValue(value === '0x' || !value ? '0x00' : value, 32)
  return offchainMarketplace.encodeFunctionData('accept', [
    [
      {
        signer: trade.signer,
        signature: trade.signature,
        checks: {
          uses: BigInt(trade.checks.uses),
          expiration: seconds(trade.checks.expiration),
          effective: seconds(trade.checks.effective),
          salt: bytes32(trade.checks.salt),
          contractSignatureIndex: BigInt(trade.checks.contractSignatureIndex),
          signerSignatureIndex: BigInt(trade.checks.signerSignatureIndex),
          allowedRoot: bytes32(trade.checks.allowedRoot),
          allowedProof: [],
          externalChecks: (trade.checks.externalChecks ?? []).map(check => ({
            contractAddress: check.contractAddress,
            selector: check.selector,
            value: check.value || '0x',
            required: check.required
          }))
        },
        sent: trade.sent.map(asset => ({
          assetType: BigInt(asset.assetType),
          contractAddress: asset.contractAddress,
          value: assetValue(asset),
          beneficiary: ZeroAddress,
          extra: asset.extra || '0x'
        })),
        received: trade.received.map(asset => ({
          assetType: BigInt(asset.assetType),
          contractAddress: asset.contractAddress,
          value: assetValue(asset),
          beneficiary: asset.beneficiary,
          extra: asset.extra || '0x'
        }))
      }
    ]
  ])
}

async function fetchTrade(id: string): Promise<ApiTrade> {
  const response = await fetch(`${MARKETPLACE_API}/trades/${id}`)
  if (!response.ok) throw new Error(`the marketplace API answered ${response.status} for trade ${id}`)
  const body = (await response.json()) as { ok?: boolean; data?: ApiTrade }
  if (!body.data) throw new Error(`the marketplace API returned no trade for ${id}`)
  return body.data
}
const store = new Interface(['function buy((address collection, uint256[] ids, uint256[] prices, address[] beneficiaries)[] _itemsToBuy)'])

type Scenario = {
  name: string
  /** What the fixture is for, kept in the file so a reader knows what to expect of it. */
  expectation: string
  /** The variables the scenario needs; missing ones skip it. */
  needs: string[]
  request: (env: Env) => Promise<SimulationRequest> | SimulationRequest
}

type SimulationRequest = { from: string; to: string; input: string; value: string }

type Env = Record<string, string | undefined>

/** A variable a scenario declared in `needs`; the scenario is skipped before this can be reached without it. */
function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const scenarios: Scenario[] = [
  {
    name: 'effect-free',
    expectation: 'success with no movements, no approvals and no logs: how Tenderly serializes an empty result',
    needs: [],
    request: () => ({ from: NOBODY, to: MANA, input: mana.encodeFunctionData('decimals', []), value: '0' })
  },
  {
    name: 'revert',
    expectation: 'a revert (MANA transfer from an address that holds none): how Tenderly serializes status and reason',
    needs: [],
    request: () => ({
      from: NOBODY,
      to: MANA,
      input: mana.encodeFunctionData('transfer', [ZeroAddress.replace(/0$/, '1'), 10n ** 30n]),
      value: '0'
    })
  },
  {
    name: 'mana-transfer',
    expectation: 'success with one ERC20 movement: the asset row and the Transfer log for the same movement',
    needs: ['FIXTURE_SENDER'],
    request: env => ({
      from: required(env, 'FIXTURE_SENDER'),
      to: MANA,
      input: mana.encodeFunctionData('transfer', [env.FIXTURE_RECIPIENT ?? NOBODY, 10n ** 18n]),
      value: '0'
    })
  },
  {
    name: 'wearable-purchase',
    expectation:
      'success with several ERC20 movements (seller, fee collector, royalties) and one ERC721 movement through OffChainMarketplaceV2.accept, plus the allowance write',
    needs: ['FIXTURE_SENDER', 'FIXTURE_TRADE_ID'],
    request: async env => {
      const trade = await fetchTrade(required(env, 'FIXTURE_TRADE_ID'))
      if (trade.network !== 'MATIC' || trade.type !== 'public_nft_order') {
        throw new Error(`trade ${trade.id} is a ${trade.type} on ${trade.network}; a public_nft_order on MATIC is needed`)
      }
      if (trade.signer.toLowerCase() === required(env, 'FIXTURE_SENDER').toLowerCase()) {
        throw new Error('the sender cannot accept a trade it signed')
      }
      return { from: required(env, 'FIXTURE_SENDER'), to: OFFCHAIN_MARKETPLACE_V2, input: acceptCalldata(trade), value: '0' }
    }
  },
  {
    name: 'collection-mint',
    expectation: 'success with ERC20 movements and an ERC721 mint (Transfer from the zero address)',
    needs: ['FIXTURE_SENDER', 'FIXTURE_ITEM_COLLECTION', 'FIXTURE_ITEM_ID', 'FIXTURE_ITEM_PRICE'],
    request: env => ({
      from: required(env, 'FIXTURE_SENDER'),
      to: COLLECTION_STORE,
      input: store.encodeFunctionData('buy', [
        [
          {
            collection: required(env, 'FIXTURE_ITEM_COLLECTION'),
            ids: [BigInt(required(env, 'FIXTURE_ITEM_ID'))],
            prices: [BigInt(required(env, 'FIXTURE_ITEM_PRICE'))],
            beneficiaries: [required(env, 'FIXTURE_SENDER')]
          }
        ]
      ]),
      value: '0'
    })
  }
]

/** process.env first, then `.env` next to the package, the same file the server reads. */
function loadEnv(): Env {
  const env: Env = { ...process.env }
  const envFile = join(__dirname, '..', '.env')
  if (!existsSync(envFile)) return env
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match && env[match[1]] === undefined) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return env
}

// The fields the adapter reads (see src/adapters/tenderly/component.ts). A full answer runs to megabytes of
// call trace and state diff and names the project; the fixture keeps the consumed fields exactly as sent
// (a null stays null, an absent key stays absent) and records which other keys were present.
const CONSUMED_TRANSACTION_KEYS = ['status', 'error_info', 'error_message'] as const
const CONSUMED_INFO_KEYS = ['logs', 'asset_changes', 'exposure_changes', 'balance_changes'] as const

function prune(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body
  const answer = body as Record<string, unknown>
  const transaction = answer.transaction as Record<string, unknown> | null | undefined
  if (typeof transaction !== 'object' || transaction === null) {
    return { presentKeys: Object.keys(answer), transaction, error: answer.error }
  }
  const info = transaction.transaction_info as Record<string, unknown> | null | undefined
  const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
    Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]))
  return {
    presentKeys: Object.keys(answer),
    transaction: {
      presentKeys: Object.keys(transaction),
      ...pick(transaction, CONSUMED_TRANSACTION_KEYS),
      ...(info === undefined
        ? {}
        : { transaction_info: info === null ? null : { presentKeys: Object.keys(info), ...pick(info, CONSUMED_INFO_KEYS) } })
    }
  }
}

async function simulate(env: Env, request: SimulationRequest): Promise<{ httpStatus: number; body: unknown }> {
  const apiUrl = (env.TENDERLY_API_URL || 'https://api.tenderly.co/api/v1').replace(/\/$/, '')
  const url = `${apiUrl}/account/${env.TENDERLY_ACCOUNT_SLUG}/project/${env.TENDERLY_PROJECT_SLUG}/simulate`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Access-Key': required(env, 'TENDERLY_ACCESS_KEY'), 'Content-Type': 'application/json' },
    // The same request the adapter sends (see src/adapters/tenderly/component.ts).
    body: JSON.stringify({ network_id: POLYGON, ...request, gas_price: '0', simulation_type: 'full', save: false, save_if_fails: false })
  })
  return { httpStatus: response.status, body: prune(await response.json().catch(() => null)) }
}

async function main(): Promise<void> {
  const env = loadEnv()
  const missing = ['TENDERLY_ACCESS_KEY', 'TENDERLY_ACCOUNT_SLUG', 'TENDERLY_PROJECT_SLUG'].filter(name => !env[name])
  if (missing.length && !process.argv.includes('--dry-run')) {
    console.error(`Missing ${missing.join(', ')}. Set them in the environment or in .env; the key is never written to disk.`)
    process.exit(1)
  }
  const dryRun = process.argv.includes('--dry-run')
  const requested = process.argv.slice(2).filter(argument => argument !== '--dry-run')
  const selected = requested.length ? scenarios.filter(scenario => requested.includes(scenario.name)) : scenarios
  if (requested.length && selected.length !== requested.length) {
    console.error(`Unknown scenario. Known: ${scenarios.map(scenario => scenario.name).join(', ')}`)
    process.exit(1)
  }
  mkdirSync(FIXTURES_DIR, { recursive: true })

  let failures = 0
  for (const scenario of selected) {
    const absent = scenario.needs.filter(name => !env[name])
    if (absent.length) {
      console.log(`skip  ${scenario.name}: needs ${absent.join(', ')}`)
      continue
    }
    let request: SimulationRequest
    try {
      request = await scenario.request(env)
    } catch (error) {
      failures++
      console.log(`FAIL  ${scenario.name}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (dryRun) {
      console.log(
        `ready ${scenario.name}: from=${request.from} to=${request.to} selector=${request.input.slice(0, 10)} calldata=${
          (request.input.length - 2) / 2
        } bytes value=${request.value}`
      )
      continue
    }
    const { httpStatus, body } = await simulate(env, request)
    const file = join(FIXTURES_DIR, `${scenario.name}.json`)
    writeFileSync(
      file,
      JSON.stringify(
        {
          scenario: scenario.name,
          expectation: scenario.expectation,
          recordedAt: new Date().toISOString(),
          networkId: POLYGON,
          request,
          httpStatus,
          response: body
        },
        null,
        2
      ) + '\n'
    )
    const transaction = (body as { transaction?: { status?: unknown; transaction_info?: Record<string, unknown> } } | null)?.transaction
    const info = transaction?.transaction_info
    const shape = info
      ? Object.entries({ logs: info.logs, asset_changes: info.asset_changes, balance_changes: info.balance_changes })
          .map(
            ([key, value]) =>
              `${key}=${
                value === undefined ? 'omitted' : value === null ? 'null' : Array.isArray(value) ? `list(${value.length})` : typeof value
              }`
          )
          .join(' ')
      : 'transaction_info=' +
        (transaction ? (transaction.transaction_info === undefined ? 'omitted' : String(transaction.transaction_info)) : 'no transaction')
    const ok = httpStatus === 200 && body !== null
    if (!ok) failures++
    console.log(
      `${ok ? 'wrote' : 'FAIL '} ${scenario.name}: http ${httpStatus}, status=${JSON.stringify(transaction?.status)}, ${shape} -> ${file}`
    )
  }
  if (failures) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
