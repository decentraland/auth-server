import { formatEther, formatUnits, id, Interface } from 'ethers'
import { TenderlyAssetChange, TenderlySimulationResult } from '../../adapters/tenderly'
import { AppComponents } from '../../types'
import { InvalidSimulationParamsError, UnsupportedChainError } from './errors'
import { ApprovalChange, AssetChange, ISimulationComponent, SimulationRequestBody, SimulationResponseBody } from './types'

// Unlimited-allowance threshold: many tokens use 2^256-1, some use 2^255+; anything
// at or above 2^255 is treated as effectively unlimited for the UI warning.
const UNLIMITED_THRESHOLD = 2n ** 255n

// Event ABI fragments. ERC20 and ERC721 `Approval` share the SAME topic0 (event
// signature hash is unaffected by `indexed`), so they must be disambiguated by
// topic count (4 topics ⇒ ERC721, 3 topics ⇒ ERC20), never by topic0 alone.
const erc20ApprovalInterface = new Interface(['event Approval(address indexed owner, address indexed spender, uint256 value)'])
const erc721ApprovalInterface = new Interface(['event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)'])
const approvalForAllInterface = new Interface(['event ApprovalForAll(address indexed owner, address indexed operator, bool approved)'])
const transferSingleInterface = new Interface([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
])
const transferBatchInterface = new Interface([
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
])

// keccak256 topic0 signatures (lowercase 0x hex).
const APPROVAL_TOPIC = id('Approval(address,address,uint256)').toLowerCase()
const APPROVAL_FOR_ALL_TOPIC = id('ApprovalForAll(address,address,bool)').toLowerCase()
const TRANSFER_SINGLE_TOPIC = id('TransferSingle(address,address,address,uint256,uint256)').toLowerCase()
const TRANSFER_BATCH_TOPIC = id('TransferBatch(address,address,address,uint256[],uint256[])').toLowerCase()

/** Lowercases an address-ish string, or returns null when absent. */
function lowerOrNull(value?: string | null): string | null {
  return value ? value.toLowerCase() : null
}

/** Narrows an unknown value to a plain object for defensive field access. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Reads a string property from an unknown value, or null. */
function asStringProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record ? record[key] : undefined
  return typeof value === 'string' ? value : null
}

/** Reads a numeric property from an unknown value, or null. */
function asNumberProp(record: Record<string, unknown> | null, key: string): number | null {
  const value = record ? record[key] : undefined
  return typeof value === 'number' ? value : null
}

/** Maps a Tenderly token standard to our DTO enum. */
function mapStandard(standard?: string): AssetChange['standard'] {
  switch ((standard ?? '').toLowerCase()) {
    case 'erc20':
      return 'erc20'
    case 'erc721':
      return 'erc721'
    case 'erc1155':
      return 'erc1155'
    case 'native':
    case 'nativecurrency':
      return 'native'
    default:
      return 'unknown'
  }
}

/** Maps a Tenderly asset change type to our DTO enum (unknown ⇒ transfer). */
function mapType(type?: string): AssetChange['type'] {
  switch ((type ?? '').toLowerCase()) {
    case 'mint':
      return 'mint'
    case 'burn':
      return 'burn'
    default:
      return 'transfer'
  }
}

/** Dedupe key for asset changes (contract + tokenId + from + to). */
function assetChangeKey(change: Pick<AssetChange, 'contractAddress' | 'tokenId' | 'from' | 'to'>): string {
  return `${change.contractAddress ?? ''}:${change.tokenId ?? ''}:${change.from ?? ''}:${change.to ?? ''}`
}

/** Token symbol/name/decimals looked up by contract address (lowercased). */
type TokenMeta = { symbol: string | null; name: string | null; decimals: number | null }

/**
 * Builds a contract-address ⇒ { symbol, name, decimals } index from Tenderly's
 * `asset_changes[].token_info` and the (undocumented) `exposure_changes`,
 * used to enrich approvals decoded from raw logs (including formatting finite
 * ERC20 allowances with the token's decimals).
 */
function buildTokenMetaIndex(assetChanges: TenderlyAssetChange[], exposureChanges: unknown[]): Map<string, TokenMeta> {
  const index = new Map<string, TokenMeta>()

  const record = (address: string | null, symbol: string | null, name: string | null, decimals: number | null) => {
    if (!address) return
    const key = address.toLowerCase()
    const existing = index.get(key)
    index.set(key, {
      symbol: symbol ?? existing?.symbol ?? null,
      name: name ?? existing?.name ?? null,
      decimals: decimals ?? existing?.decimals ?? null
    })
  }

  for (const change of assetChanges) {
    const tokenInfo = change.token_info
    if (tokenInfo?.contract_address) {
      record(tokenInfo.contract_address, tokenInfo.symbol ?? null, tokenInfo.name ?? null, tokenInfo.decimals ?? null)
    }
  }

  for (const exposure of exposureChanges) {
    const exposureRecord = asRecord(exposure)
    const tokenInfo = asRecord(exposureRecord?.token_info)
    const contract = asStringProp(tokenInfo, 'contract_address') ?? asStringProp(exposureRecord, 'contract_address')
    const symbol = asStringProp(tokenInfo, 'symbol') ?? asStringProp(exposureRecord, 'symbol')
    const name = asStringProp(tokenInfo, 'name') ?? asStringProp(exposureRecord, 'name')
    const decimals = asNumberProp(tokenInfo, 'decimals') ?? asNumberProp(exposureRecord, 'decimals')
    record(contract, symbol, name, decimals)
  }

  return index
}

/**
 * Decodes token approvals from raw EVM logs — the PRIMARY approval source.
 * Routes each log by topic0 and topic count, then enriches symbol/name from the
 * token metadata index and dedupes by (kind, contract, owner, spender, tokenId).
 *
 * Dedup keeps the LAST occurrence of a given key: ERC20 resets emit
 * `approve(0)` then `approve(MAX)` as two `Approval` logs to the same spender
 * (ERC20 tokenId is always null so they collide), and the final unlimited
 * allowance is the one we must warn about.
 */
function decodeApprovals(rawLogs: TenderlySimulationResult['rawLogs'], tokenMeta: Map<string, TokenMeta>): ApprovalChange[] {
  const approvals = new Map<string, ApprovalChange>()

  const push = (approval: ApprovalChange) => {
    const meta = tokenMeta.get(approval.contractAddress.toLowerCase())
    if (meta) {
      approval.symbol = approval.symbol ?? meta.symbol
      approval.name = approval.name ?? meta.name
      // Format a finite ERC20 allowance into a human-readable amount when the
      // token's decimals are known; leave null otherwise (frontend handles it).
      if (
        approval.kind === 'approval' &&
        approval.standard === 'erc20' &&
        !approval.isUnlimited &&
        approval.amount === null &&
        approval.rawAmount !== null &&
        meta.decimals !== null
      ) {
        approval.amount = formatUnits(BigInt(approval.rawAmount), meta.decimals)
      }
    }
    // Include `kind` so an `approval` and `approvalForAll` for the same triple
    // don't collide; `.set()` means a later occurrence overwrites an earlier one.
    const dedupeKey = `${approval.kind}:${approval.contractAddress}:${approval.owner}:${approval.spender}:${approval.tokenId ?? ''}`
    approvals.set(dedupeKey, approval)
  }

  for (const log of rawLogs) {
    // Defensively skip malformed logs (missing topics/address) so a single bad
    // entry can't throw and defeat the fail-open decoding of the rest.
    if (!log || !Array.isArray(log.topics) || typeof log.address !== 'string') continue
    const topic0 = log.topics[0]?.toLowerCase()
    const contractAddress = log.address.toLowerCase()

    try {
      if (topic0 === APPROVAL_TOPIC && log.topics.length === 4) {
        const parsed = erc721ApprovalInterface.parseLog({ topics: log.topics, data: log.data })
        if (!parsed) continue
        push({
          kind: 'approval',
          standard: 'erc721',
          owner: (parsed.args.owner as string).toLowerCase(),
          spender: (parsed.args.approved as string).toLowerCase(),
          amount: null,
          rawAmount: null,
          isUnlimited: false,
          tokenId: (parsed.args.tokenId as bigint).toString(),
          approved: null,
          contractAddress,
          symbol: null,
          name: null
        })
      } else if (topic0 === APPROVAL_TOPIC && log.topics.length === 3) {
        const parsed = erc20ApprovalInterface.parseLog({ topics: log.topics, data: log.data })
        if (!parsed) continue
        const value = parsed.args.value as bigint
        push({
          kind: 'approval',
          standard: 'erc20',
          owner: (parsed.args.owner as string).toLowerCase(),
          spender: (parsed.args.spender as string).toLowerCase(),
          amount: null,
          rawAmount: value.toString(),
          isUnlimited: value >= UNLIMITED_THRESHOLD,
          tokenId: null,
          approved: null,
          contractAddress,
          symbol: null,
          name: null
        })
      } else if (topic0 === APPROVAL_FOR_ALL_TOPIC) {
        const parsed = approvalForAllInterface.parseLog({ topics: log.topics, data: log.data })
        if (!parsed) continue
        const approved = parsed.args.approved as boolean
        push({
          kind: 'approvalForAll',
          // ApprovalForAll(address,address,bool) always has exactly 3 topics, so
          // erc721 vs erc1155 can't be told apart from an ApprovalForAll's topics.
          standard: 'unknown',
          owner: (parsed.args.owner as string).toLowerCase(),
          spender: (parsed.args.operator as string).toLowerCase(),
          amount: null,
          rawAmount: null,
          isUnlimited: approved === true,
          tokenId: null,
          approved,
          contractAddress,
          symbol: null,
          name: null
        })
      }
    } catch {
      // Unparseable log for this fragment — skip it (fail-open).
    }
  }

  return [...approvals.values()]
}

/**
 * Decodes ERC1155 `TransferSingle`/`TransferBatch` raw logs into asset changes.
 * Tenderly's `asset_changes` only reliably covers ERC20/721, so this is the
 * fallback source for 1155 transfers. Batches expand to one entry per (id, value).
 */
function decodeErc1155Transfers(rawLogs: TenderlySimulationResult['rawLogs']): AssetChange[] {
  const changes: AssetChange[] = []

  const build = (contractAddress: string, from: string, to: string, tokenId: bigint, value: bigint): AssetChange => ({
    type: 'transfer',
    standard: 'erc1155',
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    amount: null,
    rawAmount: value.toString(),
    tokenId: tokenId.toString(),
    contractAddress: contractAddress.toLowerCase(),
    symbol: null,
    name: null,
    decimals: null,
    logoUrl: null,
    dollarValue: null
  })

  for (const log of rawLogs) {
    // Defensively skip malformed logs (missing topics/address) so a single bad
    // entry can't throw and defeat the fail-open decoding of the rest.
    if (!log || !Array.isArray(log.topics) || typeof log.address !== 'string') continue
    const topic0 = log.topics[0]?.toLowerCase()
    try {
      if (topic0 === TRANSFER_SINGLE_TOPIC) {
        const parsed = transferSingleInterface.parseLog({ topics: log.topics, data: log.data })
        if (!parsed) continue
        changes.push(
          build(log.address, parsed.args.from as string, parsed.args.to as string, parsed.args.id as bigint, parsed.args.value as bigint)
        )
      } else if (topic0 === TRANSFER_BATCH_TOPIC) {
        const parsed = transferBatchInterface.parseLog({ topics: log.topics, data: log.data })
        if (!parsed) continue
        // Access by index: `Result` exposes an array-like `.values()` method that
        // shadows a named `values` arg, so named access would return the method.
        const from = parsed.args[1] as string
        const to = parsed.args[2] as string
        const ids = parsed.args[3] as bigint[]
        const values = parsed.args[4] as bigint[]
        for (let i = 0; i < ids.length; i++) {
          changes.push(build(log.address, from, to, ids[i], values[i]))
        }
      }
    } catch {
      // Unparseable log — skip it (fail-open).
    }
  }

  return changes
}

/**
 * Creates the simulation logic component.
 *
 * Orchestration of `simulateTransaction`:
 * 1. Rejects unsupported chains and normalizes `value`/`data`.
 * 2. Delegates the actual simulation to the Tenderly adapter.
 * 3. Maps Tenderly's asset changes into the normalized DTO (addresses lowercased).
 * 4. Decodes approvals from raw logs (primary source) and enriches metadata.
 * 5. Adds ERC1155 transfer and native-value fallbacks the adapter can't provide.
 *
 * @param components - `tenderly` and `logs`.
 * @param options - `supportedChainIds`, the allowlist of chains we simulate.
 * @returns The simulation component.
 */
export async function createSimulationComponent(
  { tenderly, logs }: Pick<AppComponents, 'tenderly' | 'logs'>,
  { supportedChainIds }: { supportedChainIds: number[] }
): Promise<ISimulationComponent> {
  const logger = logs.getLogger('simulation')

  const simulateTransaction = async (body: SimulationRequestBody): Promise<SimulationResponseBody> => {
    // 1. Chain allowlist.
    if (!supportedChainIds.includes(body.chainId)) {
      throw new UnsupportedChainError(body.chainId)
    }

    // 2. Normalize inputs. BigInt accepts both `0x…` and decimal strings.
    let value: string
    try {
      value = body.value ? BigInt(body.value).toString() : '0'
    } catch {
      throw new InvalidSimulationParamsError('`value` must be a valid hex or decimal integer')
    }
    const data = body.data ?? '0x'

    // 3. Simulate (re-throws the adapter's typed Tenderly errors).
    const result = await tenderly.simulate({
      networkId: String(body.chainId),
      from: body.from,
      to: body.to,
      input: data,
      value
    })

    const status: SimulationResponseBody['status'] = result.status === false ? 'reverted' : 'success'

    // 4. Map Tenderly asset changes defensively (all missing fields ⇒ null).
    const assetChanges: AssetChange[] = result.assetChanges.map(change => ({
      type: mapType(change.type),
      standard: mapStandard(change.token_info?.standard),
      from: lowerOrNull(change.from),
      to: lowerOrNull(change.to),
      amount: change.amount ?? null,
      rawAmount: change.raw_amount ?? null,
      tokenId: change.token_id ?? null,
      contractAddress: lowerOrNull(change.token_info?.contract_address),
      symbol: change.token_info?.symbol ?? null,
      name: change.token_info?.name ?? null,
      decimals: change.token_info?.decimals ?? null,
      logoUrl: change.token_info?.logo ?? null,
      dollarValue: change.dollar_value ?? null
    }))

    // 5. Approvals from raw logs (primary source), enriched with token metadata.
    const tokenMeta = buildTokenMetaIndex(result.assetChanges, result.exposureChanges)
    const approvalChanges = decodeApprovals(result.rawLogs, tokenMeta)

    // 6. ERC1155 transfer fallback — only add transfers not already present.
    const existingKeys = new Set(assetChanges.map(assetChangeKey))
    for (const erc1155Change of decodeErc1155Transfers(result.rawLogs)) {
      const key = assetChangeKey(erc1155Change)
      if (!existingKeys.has(key)) {
        existingKeys.add(key)
        assetChanges.push(erc1155Change)
      }
    }

    // 7. Native-value fallback — synthesize a native transfer when the tx succeeded,
    //    value > 0 and Tenderly did not already report one. A reverted tx moves no
    //    value, so we must not invent a transfer for it.
    if (status === 'success' && BigInt(value) > 0n && !assetChanges.some(change => change.standard === 'native')) {
      assetChanges.push({
        type: 'transfer',
        standard: 'native',
        from: body.from.toLowerCase(),
        to: body.to.toLowerCase(),
        amount: formatEther(value),
        rawAmount: value,
        tokenId: null,
        contractAddress: null,
        symbol: null,
        name: null,
        decimals: 18,
        logoUrl: null,
        dollarValue: null
      })
    }

    logger.debug(
      `Simulated tx on chain ${body.chainId}: status=${status} assets=${assetChanges.length} approvals=${approvalChanges.length}`
    )

    const response: SimulationResponseBody = {
      status,
      assetChanges,
      approvalChanges,
      balanceChanges: result.balanceChanges,
      events: result.events
    }
    if (status === 'reverted' && result.errorMessage) {
      response.error = result.errorMessage
    }
    return response
  }

  return { simulateTransaction }
}
