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
  /**
   * Movements of the signer's and the counterparties' assets: every movement the raw logs record (one row per
   * Transfer, TransferSingle or TransferBatch entry, named and priced from what Tenderly said about it) plus
   * every Tenderly row no log accounts for. A Tenderly row describing a logged movement is folded into that
   * row; nothing is dropped, so a movement can appear twice only where the two sources describe it differently.
   */
  assetChanges: AssetChange[]
  approvalChanges: ApprovalChange[]
  balanceChanges: BalanceChange[]
  /**
   * Every event the transaction emitted, complete. Nothing in a preview is ever truncated: a response with
   * more entries than a preview can report is refused instead, so the absence of an event here is evidence
   * that the emitting contract did nothing rather than an artefact of a cap.
   */
  events: SimulationEvent[]
}

export type ISimulationComponent = {
  /**
   * Checks what `simulateTransaction` would refuse before reaching the upstream provider: throws
   * `UnsupportedChainError` for a chain this service does not simulate and `InvalidSimulationParamsError`
   * for a `value` that is not an integer. Lets the endpoint refuse a request before spending a paid call.
   */
  validateRequest(body: SimulationRequestBody): void
  /**
   * Simulates a transaction via Tenderly and returns a normalized summary of
   * asset transfers, token approvals and whether it would revert. Throws
   * `UnsupportedChainError` / `InvalidSimulationParamsError` and re-throws the
   * adapter's typed Tenderly errors.
   */
  simulateTransaction(body: SimulationRequestBody): Promise<SimulationResponseBody>
}

/**
 * Why `POST /simulations` refused a request.
 *
 * On a 400: `invalid_request` when this server refused the request itself (JSON, schema, chain,
 * parameters), `upstream_rejected` when the simulation provider did. The auth dapp refuses the reviewed
 * request on the first and treats the second as an outage.
 *
 * On a 429: `quota_exceeded` when this service's own rate limit refused the call, `upstream_rate_limited`
 * when the provider's did. Both leave the dapp without a preview, so both degrade to the acknowledgment —
 * but only the first is self-inflicted, and telling them apart is what makes a flood aimed at suppressing
 * previews visible as one instead of reading like provider flakiness. `quota_exceeded` covers the global
 * cap as well as the per-IP one: the global cap is a single shared counter, so any client that can reach
 * the endpoint can exhaust it for everyone.
 */
export type SimulationRejectionCode = 'invalid_request' | 'upstream_rejected' | 'quota_exceeded' | 'upstream_rate_limited'

/** The body of a 400 or a 429 from `POST /simulations`. */
export type SimulationErrorResponse = {
  error: string
  code: SimulationRejectionCode
}
