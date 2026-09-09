import { formatEther, formatUnits, id, Interface, ZeroAddress } from 'ethers'
import { TenderlySimulationResult } from '../../adapters/tenderly'
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
// ERC20 and ERC721 `Transfer` share topic0 as well; only the 4-topic ERC721 form (indexed tokenId) is read here.
const erc721TransferInterface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'])
const transferSingleInterface = new Interface([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
])
const transferBatchInterface = new Interface([
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
])

// keccak256 topic0 signatures (lowercase 0x hex).
const APPROVAL_TOPIC = id('Approval(address,address,uint256)').toLowerCase()
const TRANSFER_TOPIC = id('Transfer(address,address,uint256)').toLowerCase()
const TRANSFER_SINGLE_TOPIC = id('TransferSingle(address,address,address,uint256,uint256)').toLowerCase()
const TRANSFER_BATCH_TOPIC = id('TransferBatch(address,address,address,uint256[],uint256[])').toLowerCase()
const APPROVAL_FOR_ALL_TOPIC = id('ApprovalForAll(address,address,bool)').toLowerCase()

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

/** Reads a property Tenderly may send as a string or a number (amounts, ids) as a string, or null. */
function asStringishProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record ? record[key] : undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
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

/** The ERC721 transfers a transaction's raw logs record, as `contract:tokenId:from`, the key the approval filter looks up. */
function decodeErc721Transfers(rawLogs: TenderlySimulationResult['rawLogs']): Set<string> {
  const transfers = new Set<string>()
  for (const log of rawLogs) {
    if (!log || !Array.isArray(log.topics) || typeof log.address !== 'string') continue
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 4) continue
    try {
      const parsed = erc721TransferInterface.parseLog({ topics: log.topics, data: log.data })
      if (!parsed) continue
      transfers.add(
        `${log.address.toLowerCase()}:${(parsed.args.tokenId as bigint).toString()}:${(parsed.args.from as string).toLowerCase()}`
      )
    } catch {
      // A malformed log is skipped, like everywhere else in this decoder.
    }
  }
  return transfers
}

/**
 * Drops the ERC721 `Approval` a transfer emits as a side effect. Transferring a token clears its per-token
 * approval, and every OpenZeppelin-derived collection announces the clear as `Approval(owner, 0x0, tokenId)`,
 * which would otherwise show as a permission change on every transfer. Only that clear is dropped: an
 * approval to the zero address, by an owner the same transaction logs transferring that token. An approval
 * to the zero address is never a grant, so nothing dropped is a permission the user ends up holding, and a
 * grant to a real spender is always kept, whatever transfers surround it (a token that comes back to its
 * owner and is then approved shows that approval). A revocation the owner makes without transferring the
 * token is kept too.
 *
 * ERC20 approvals are deliberately kept as reported. An ERC20 `transferFrom` also writes the remaining
 * allowance as `Approval(owner, spender, remaining)`, but logs alone cannot tell that write from a real
 * `approve` in the same transaction (a transfer followed by a grant to someone else), so hiding on that
 * evidence could hide a genuine grant. The client knows which function the user's calldata decodes to and
 * applies the precise rule there: the signer's allowance only changes by a grant when the signer's own
 * call is an allowance function.
 */
function withoutTransferImpliedApprovals(approvals: ApprovalChange[], transfers: Set<string>): ApprovalChange[] {
  return approvals.filter(approval => {
    if (approval.kind !== 'approval' || approval.standard !== 'erc721' || approval.spender !== ZeroAddress) return true
    return !transfers.has(`${approval.contractAddress}:${approval.tokenId}:${approval.owner}`)
  })
}

/** Token symbol/name/decimals looked up by contract address (lowercased). */
type TokenMeta = { symbol: string | null; name: string | null; decimals: number | null }

/**
 * Builds a contract-address ⇒ { symbol, name, decimals } index from Tenderly's
 * `asset_changes[].token_info` and the (undocumented) `exposure_changes`,
 * used to enrich approvals decoded from raw logs (including formatting finite
 * ERC20 allowances with the token's decimals).
 */
function buildTokenMetaIndex(assetChanges: unknown[], exposureChanges: unknown[]): Map<string, TokenMeta> {
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
    const tokenInfo = asRecord(asRecord(change)?.token_info)
    record(
      asStringProp(tokenInfo, 'contract_address'),
      asStringProp(tokenInfo, 'symbol'),
      asStringProp(tokenInfo, 'name'),
      asNumberProp(tokenInfo, 'decimals')
    )
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
 * Decodes every ERC1155 `TransferSingle`/`TransferBatch` raw log into asset changes, one per (id, value).
 * Tenderly's `asset_changes` only reliably covers ERC20/721, and the standard requires one of these events
 * for every ERC1155 movement, so the logs are the complete record of them.
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
        // Access by index: `Result` exposes an array-like `.values()` method that shadows a named
        // `values` arg, so named access would return the method.
        const from = parsed.args[1] as string
        const to = parsed.args[2] as string
        const ids = parsed.args[3] as bigint[]
        const values = parsed.args[4] as bigint[]
        for (let i = 0; i < ids.length; i++) {
          changes.push(build(log.address, from, to, ids[i], values[i]))
        }
      }
    } catch {
      // A malformed log is skipped, like everywhere else in this decoder.
    }
  }

  return changes
}

const MAX_REVERT_REASON_LENGTH = 200

/**
 * A revert reason fit for display: control and format characters removed, length bounded. The text comes from
 * the contract that reverted, and on a revert it is the only content of the preview.
 */
function sanitizeRevertReason(message: string | null): string | null {
  if (!message) return null
  const cleaned = message
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.length > MAX_REVERT_REASON_LENGTH ? `${cleaned.slice(0, MAX_REVERT_REASON_LENGTH - 1)}…` : cleaned
}

/**
 * Creates the simulation logic component.
 *
 * Orchestration of `simulateTransaction`:
 * 1. Rejects unsupported chains and normalizes `value`/`data`.
 * 2. Delegates the actual simulation to the Tenderly adapter.
 * 3. Maps Tenderly's asset changes into the normalized DTO (addresses lowercased).
 * 4. Decodes approvals from raw logs (primary source) and enriches metadata.
 * 5. Adds every ERC1155 movement the raw logs record, and the native-value fallback the adapter can't
 *    provide.
 *
 * ERC1155 is not supported by the auth dapp: no Decentraland contract is one, and the dapp refuses any
 * preview that carries a row of that standard. The rows are reported so that it can: a movement left out
 * would show a no-effect preview for a call that moves assets.
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

    // A reverted transaction changes nothing: no asset moves, no approval is granted, no balance changes and
    // no event is emitted, whatever the simulator traced before the revert. Only the status and the reason
    // are reported, and the reason, text the called contract wrote and the whole preview in this case, is
    // stripped of control characters and bounded.
    if (result.status === false) {
      logger.debug(`Simulated tx on chain ${body.chainId}: status=reverted`)
      const response: SimulationResponseBody = { status: 'reverted', assetChanges: [], approvalChanges: [], balanceChanges: [], events: [] }
      const reason = sanitizeRevertReason(result.errorMessage)
      if (reason) response.error = reason
      return response
    }

    // 4. Map Tenderly asset changes field by field: every field is read for its type and a field of another
    //    type reads as absent, so a reshaped entry can never crash the normalization (an absent field is
    //    null, an unknown standard is 'unknown').
    const reportedChanges: AssetChange[] = result.assetChanges.map((entry: unknown) => {
      const change = asRecord(entry)
      const tokenInfo = asRecord(change?.token_info)
      return {
        type: mapType(asStringProp(change, 'type') ?? undefined),
        standard: mapStandard(asStringProp(tokenInfo, 'standard') ?? undefined),
        from: lowerOrNull(asStringProp(change, 'from')),
        to: lowerOrNull(asStringProp(change, 'to')),
        amount: asStringishProp(change, 'amount'),
        rawAmount: asStringishProp(change, 'raw_amount'),
        tokenId: asStringishProp(change, 'token_id'),
        contractAddress: lowerOrNull(asStringProp(tokenInfo, 'contract_address')),
        symbol: asStringProp(tokenInfo, 'symbol'),
        name: asStringProp(tokenInfo, 'name'),
        decimals: asNumberProp(tokenInfo, 'decimals'),
        logoUrl: asStringProp(tokenInfo, 'logo'),
        dollarValue: asStringishProp(change, 'dollar_value')
      }
    })

    // ERC1155 movements have one source per contract. The raw logs are the authoritative one: the standard
    // requires a TransferSingle or TransferBatch for every movement, and Tenderly's rows of that standard are
    // unreliable, so where the logs record any movement on a contract, Tenderly's rows for that contract are
    // dropped and each logged movement is reported once. Where the logs record none, Tenderly's rows stay:
    // a partial answer must never turn a reported movement into a clean preview.
    const loggedErc1155 = decodeErc1155Transfers(result.rawLogs)
    const contractsWithLoggedMovements = new Set(loggedErc1155.map(change => change.contractAddress))
    const assetChanges: AssetChange[] = reportedChanges.filter(
      change => change.standard !== 'erc1155' || !contractsWithLoggedMovements.has(change.contractAddress)
    )

    // 5. Approvals from raw logs (primary source), enriched with token metadata, minus the ones a
    //    transfer in the same transaction implies (see withoutTransferImpliedApprovals).
    const tokenMeta = buildTokenMetaIndex(result.assetChanges, result.exposureChanges)
    const approvalChanges = withoutTransferImpliedApprovals(
      decodeApprovals(result.rawLogs, tokenMeta),
      decodeErc721Transfers(result.rawLogs)
    )

    // 6. The ERC1155 movements the logs record (see step 4 for what they replace).
    assetChanges.push(...loggedErc1155)

    // 7. Native-value fallback: synthesize a native transfer when value > 0 and Tenderly did not report one
    //    (a revert never reaches this point).
    if (BigInt(value) > 0n && !assetChanges.some(change => change.standard === 'native')) {
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

    logger.debug(`Simulated tx on chain ${body.chainId}: status=success assets=${assetChanges.length} approvals=${approvalChanges.length}`)

    return { status: 'success', assetChanges, approvalChanges, balanceChanges: result.balanceChanges, events: result.events }
  }

  return { simulateTransaction }
}
