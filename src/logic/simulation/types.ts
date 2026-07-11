// ─────────────────────────────────────────────────────────────────────────────
// Shared DTO — contract between auth-server and the auth site frontend.
// These types must match the frontend's `auth/src/shared/auth/types.ts`
// byte-for-byte. Do NOT change field names/shapes without updating both repos.
// ─────────────────────────────────────────────────────────────────────────────

/** POST /simulations request body. */
export type SimulationRequestBody = {
  chainId: number
  from: string
  to: string
  /** Transaction calldata (`0x…`). Defaults to `'0x'` when omitted. */
  data?: string
  /** Wei value as a hex (`0x…`) or decimal string. Defaults to `'0'`. */
  value?: string
}

/** A normalized asset transfer/mint/burn in the simulation summary. */
export type AssetChange = {
  type: 'transfer' | 'mint' | 'burn'
  standard: 'native' | 'erc20' | 'erc721' | 'erc1155' | 'unknown'
  from: string | null
  to: string | null
  amount: string | null
  rawAmount: string | null
  tokenId: string | null
  contractAddress: string | null
  symbol: string | null
  name: string | null
  decimals: number | null
  logoUrl: string | null
  dollarValue: string | null
}

/** A normalized token approval granted (or revoked) by the transaction. */
export type ApprovalChange = {
  kind: 'approval' | 'approvalForAll'
  standard: 'erc20' | 'erc721' | 'unknown'
  owner: string
  spender: string
  amount: string | null
  rawAmount: string | null
  /** `rawAmount >= 2^255` (or an `approved === true` ApprovalForAll). */
  isUnlimited: boolean
  tokenId: string | null
  /** ApprovalForAll flag (`false` = revoke, still shown). `null` for plain approvals. */
  approved: boolean | null
  contractAddress: string
  symbol: string | null
  name: string | null
}

/** Net dollar balance change for an address across the whole transaction. */
export type BalanceChange = {
  address: string
  /** Signed net USD delta for this address, or null when price data is unavailable. */
  dollarValue: string | null
}

/** A decoded event log emitted by the transaction (advanced/technical detail). */
export type SimulationEvent = {
  /** Decoded event name (e.g. "Transfer"), or null when the log couldn't be decoded. */
  name: string | null
  /** Emitting contract address (lowercased). */
  address: string
}

/** POST /simulations 200 response body. */
export type SimulationResponseBody = {
  status: 'success' | 'reverted'
  /** Revert reason, only present when `status === 'reverted'`. */
  error?: string
  assetChanges: AssetChange[]
  approvalChanges: ApprovalChange[]
  balanceChanges: BalanceChange[]
  events: SimulationEvent[]
}

export type ISimulationComponent = {
  /**
   * Simulates a transaction via Tenderly and returns a normalized summary of
   * asset transfers, token approvals and whether it would revert. Throws
   * `UnsupportedChainError` / `InvalidSimulationParamsError` and re-throws the
   * adapter's typed Tenderly errors.
   */
  simulateTransaction(body: SimulationRequestBody): Promise<SimulationResponseBody>
}
