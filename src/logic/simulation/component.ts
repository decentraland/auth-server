import { formatEther, formatUnits, id, Interface, ZeroAddress } from 'ethers'
import { TenderlySimulationResult } from '../../adapters/tenderly'
import { AppComponents } from '../../types'
import { InvalidSimulationParamsError, UnreadableSimulationError, UnsupportedChainError } from './errors'
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
const erc20TransferInterface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
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

/**
 * Reads a quantity the preview depends on exactly (a raw amount, a token id) as a decimal string, or null.
 * The adapter has already refused anything but an unsigned integer in canonical decimal or hexadecimal form,
 * or a non-negative number a double holds exactly; a hexadecimal form is written out in decimal here so one
 * quantity has one spelling wherever it is compared.
 */
function asExactQuantityProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record ? record[key] : undefined
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) return value
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value).toString()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return null
}

/** Reads a display-only figure (a decimals-applied amount, a dollar value) as a string, or null. */
function asDisplayNumberProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record ? record[key] : undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Reads an ERC20 `decimals` (a uint8) or null; anything else would make formatUnits throw. */
function asDecimalsProp(record: Record<string, unknown> | null): number | null {
  const value = record ? record.decimals : undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255 ? value : null
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

// A log that carries the signature of an effect this service reports must decode as one; a log that does not
// (truncated data, a wrong topic count) cannot be told from an effect that went unreported, so the simulation
// is failed rather than read short (see UnreadableSimulationError).
function decodeOrFail<T>(name: string, decode: () => T | null): T {
  let decoded: T | null
  try {
    decoded = decode()
  } catch {
    decoded = null
  }
  if (decoded === null) {
    throw new UnreadableSimulationError(`a ${name} log could not be decoded`)
  }
  return decoded
}

/** A token movement a raw `Transfer` log records: the ERC721 form indexes the token id, the ERC20 form carries the value in the data. */
type LoggedTransfer = {
  standard: 'erc20' | 'erc721'
  contractAddress: string
  from: string
  to: string
  /** Decimal, ERC721 only. */
  tokenId: string | null
  /** Decimal, ERC20 only. */
  rawAmount: string | null
}

/**
 * Every ERC20 and ERC721 movement the raw logs record, addresses lowercased. Both standards share the
 * `Transfer` signature; the topic count tells them apart (four with the indexed token id, three with the
 * value in the data). A `Transfer` of any other topic count, or one that does not decode, is an effect this
 * service cannot report and fails the simulation (see decodeOrFail).
 */
function decodeTransfers(rawLogs: TenderlySimulationResult['rawLogs']): LoggedTransfer[] {
  const transfers: LoggedTransfer[] = []
  for (const log of rawLogs) {
    if (!log || !Array.isArray(log.topics) || typeof log.address !== 'string') continue
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
    const contractAddress = log.address.toLowerCase()
    if (log.topics.length === 4) {
      const parsed = decodeOrFail('Transfer', () => erc721TransferInterface.parseLog({ topics: log.topics, data: log.data }))
      transfers.push({
        standard: 'erc721',
        contractAddress,
        from: (parsed.args.from as string).toLowerCase(),
        to: (parsed.args.to as string).toLowerCase(),
        tokenId: (parsed.args.tokenId as bigint).toString(),
        rawAmount: null
      })
    } else if (log.topics.length === 3) {
      const parsed = decodeOrFail('Transfer', () => erc20TransferInterface.parseLog({ topics: log.topics, data: log.data }))
      transfers.push({
        standard: 'erc20',
        contractAddress,
        from: (parsed.args.from as string).toLowerCase(),
        to: (parsed.args.to as string).toLowerCase(),
        tokenId: null,
        rawAmount: (parsed.args.value as bigint).toString()
      })
    } else {
      throw new UnreadableSimulationError('a Transfer log carries neither the ERC20 nor the ERC721 topics')
    }
  }
  return transfers
}

/** The `contract:tokenId:from` keys of the ERC721 movements, which the approval filter looks up. */
function erc721TransferKeys(transfers: LoggedTransfer[]): Set<string> {
  return new Set(transfers.filter(t => t.standard === 'erc721').map(t => `${t.contractAddress}:${t.tokenId}:${t.from}`))
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
      asDecimalsProp(tokenInfo)
    )
  }

  for (const exposure of exposureChanges) {
    const exposureRecord = asRecord(exposure)
    const tokenInfo = asRecord(exposureRecord?.token_info)
    const contract = asStringProp(tokenInfo, 'contract_address') ?? asStringProp(exposureRecord, 'contract_address')
    const symbol = asStringProp(tokenInfo, 'symbol') ?? asStringProp(exposureRecord, 'symbol')
    const name = asStringProp(tokenInfo, 'name') ?? asStringProp(exposureRecord, 'name')
    const decimals = asDecimalsProp(tokenInfo) ?? asDecimalsProp(exposureRecord)
    record(contract, symbol, name, decimals)
  }

  return index
}

/** Whether a Tenderly row describes the given logged ERC20 or ERC721 movement. A mint's `from` and a burn's `to` may be reported as the zero address or left out. */
function describesTransfer(transfer: LoggedTransfer): (change: AssetChange) => boolean {
  return change =>
    change.contractAddress === transfer.contractAddress &&
    sameParty(change.from, transfer.from) &&
    sameParty(change.to, transfer.to) &&
    (transfer.standard === 'erc721' ? change.tokenId === transfer.tokenId : change.rawAmount === transfer.rawAmount)
}

/** Whether a Tenderly row describes the given logged ERC1155 movement. */
function describesErc1155(logged: AssetChange): (change: AssetChange) => boolean {
  return change =>
    change.contractAddress === logged.contractAddress &&
    sameParty(change.from, logged.from) &&
    sameParty(change.to, logged.to) &&
    change.tokenId === logged.tokenId &&
    (change.rawAmount === null || change.rawAmount === logged.rawAmount)
}

function sameParty(reported: string | null, logged: string | null): boolean {
  return reported === logged || (reported === null && logged === ZeroAddress)
}

/** What a consumed Tenderly row lends a logged movement: Tenderly's pricing and naming, never its identity. */
function enrich(logged: AssetChange, match: AssetChange | undefined): AssetChange {
  if (!match) return logged
  return {
    ...logged,
    amount: logged.amount ?? match.amount,
    symbol: logged.symbol ?? match.symbol,
    name: logged.name ?? match.name,
    decimals: logged.decimals ?? match.decimals,
    logoUrl: match.logoUrl,
    dollarValue: match.dollarValue
  }
}

/**
 * A logged movement as an asset row. The token is named from what Tenderly said about it (its rows and
 * exposure changes, indexed by contract); a decimals-applied amount is computed for an ERC20 whose decimals
 * are known; and the Tenderly row consumed for this very movement, if any, lends its dollar value, logo and
 * display amount (see enrich). A movement to the zero address is a burn, from it a mint.
 */
function toAssetChange(transfer: LoggedTransfer, tokenMeta: Map<string, TokenMeta>, match: AssetChange | undefined): AssetChange {
  const meta = tokenMeta.get(transfer.contractAddress)
  const decimals = meta?.decimals ?? match?.decimals ?? null
  const amount =
    transfer.standard === 'erc20' && transfer.rawAmount !== null && decimals !== null
      ? formatUnits(BigInt(transfer.rawAmount), decimals)
      : null
  return enrich(
    {
      type: movementType(transfer.from, transfer.to),
      standard: transfer.standard,
      from: transfer.from,
      to: transfer.to,
      amount,
      rawAmount: transfer.rawAmount,
      tokenId: transfer.tokenId,
      contractAddress: transfer.contractAddress,
      symbol: meta?.symbol ?? null,
      name: meta?.name ?? null,
      decimals,
      logoUrl: null,
      dollarValue: null
    },
    match
  )
}

/** A movement from the zero address is a mint, to it a burn. */
function movementType(from: string, to: string): AssetChange['type'] {
  return from === ZeroAddress ? 'mint' : to === ZeroAddress ? 'burn' : 'transfer'
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
    if (!log || !Array.isArray(log.topics) || typeof log.address !== 'string') continue
    const topic0 = log.topics[0]?.toLowerCase()
    const contractAddress = log.address.toLowerCase()

    if (topic0 === APPROVAL_TOPIC && log.topics.length === 4) {
      const parsed = decodeOrFail('Approval', () => erc721ApprovalInterface.parseLog({ topics: log.topics, data: log.data }))
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
      const parsed = decodeOrFail('Approval', () => erc20ApprovalInterface.parseLog({ topics: log.topics, data: log.data }))
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
    } else if (topic0 === APPROVAL_TOPIC) {
      throw new UnreadableSimulationError('an Approval log carries neither the ERC20 nor the ERC721 topics')
    } else if (topic0 === APPROVAL_FOR_ALL_TOPIC) {
      const parsed = decodeOrFail('ApprovalForAll', () => approvalForAllInterface.parseLog({ topics: log.topics, data: log.data }))
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
    type: movementType(from.toLowerCase(), to.toLowerCase()),
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
    if (topic0 === TRANSFER_SINGLE_TOPIC) {
      const parsed = decodeOrFail('TransferSingle', () => transferSingleInterface.parseLog({ topics: log.topics, data: log.data }))
      changes.push(
        build(log.address, parsed.args.from as string, parsed.args.to as string, parsed.args.id as bigint, parsed.args.value as bigint)
      )
    } else if (topic0 === TRANSFER_BATCH_TOPIC) {
      const parsed = decodeOrFail('TransferBatch', () => transferBatchInterface.parseLog({ topics: log.topics, data: log.data }))
      // Access by index: `Result` exposes an array-like `.values()` method that shadows a named
      // `values` arg, so named access would return the method.
      const from = parsed.args[1] as string
      const to = parsed.args[2] as string
      const ids = parsed.args[3] as bigint[]
      const values = parsed.args[4] as bigint[]
      // The ABI encodes the two arrays apart, so they decode whatever their lengths; the standard requires
      // one value per id, and a batch that breaks that cannot be reported as movements.
      if (ids.length !== values.length) {
        throw new UnreadableSimulationError('a TransferBatch log carries a different number of ids and values')
      }
      for (let i = 0; i < ids.length; i++) {
        changes.push(build(log.address, from, to, ids[i], values[i]))
      }
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
        amount: asDisplayNumberProp(change, 'amount'),
        rawAmount: asExactQuantityProp(change, 'raw_amount'),
        tokenId: asExactQuantityProp(change, 'token_id'),
        contractAddress: lowerOrNull(asStringProp(tokenInfo, 'contract_address')),
        symbol: asStringProp(tokenInfo, 'symbol'),
        name: asStringProp(tokenInfo, 'name'),
        decimals: asDecimalsProp(tokenInfo),
        logoUrl: asStringProp(tokenInfo, 'logo'),
        dollarValue: asDisplayNumberProp(change, 'dollar_value')
      }
    })

    // 5. Token movements are the union of what the raw logs record and what Tenderly reported, reconciled
    //    per movement, and nothing is ever dropped: every standard requires an event per movement, so every
    //    logged Transfer, TransferSingle or TransferBatch entry is a row; a Tenderly row that describes the
    //    same movement (contract, parties, and token id or amount) is consumed into it and lends it the
    //    dollar value, logo and display amount Tenderly computed; a Tenderly row no log accounts for stays as
    //    reported, since the logs may be partial too. A partial answer from either side can therefore never
    //    hide a movement; where the two disagree on how to describe one, both descriptions are shown rather
    //    than one guessed.
    const tokenMeta = buildTokenMetaIndex(result.assetChanges, result.exposureChanges)
    const unconsumed = reportedChanges.filter(change => change.standard !== 'native')
    const consume = (predicate: (change: AssetChange) => boolean): AssetChange | undefined => {
      const index = unconsumed.findIndex(predicate)
      return index === -1 ? undefined : unconsumed.splice(index, 1)[0]
    }
    const loggedTransfers = decodeTransfers(result.rawLogs)
    const loggedRows = [
      ...loggedTransfers.map(transfer => toAssetChange(transfer, tokenMeta, consume(describesTransfer(transfer)))),
      ...decodeErc1155Transfers(result.rawLogs).map(logged => enrich(logged, consume(describesErc1155(logged))))
    ]
    const assetChanges: AssetChange[] = [...reportedChanges.filter(change => change.standard === 'native'), ...unconsumed, ...loggedRows]

    // 6. Approvals from raw logs (primary source), enriched with token metadata, minus the ones a
    //    transfer in the same transaction implies (see withoutTransferImpliedApprovals).
    const approvalChanges = withoutTransferImpliedApprovals(decodeApprovals(result.rawLogs, tokenMeta), erc721TransferKeys(loggedTransfers))

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
