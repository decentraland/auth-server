/** Token metadata as reported inside a Tenderly `asset_changes[]` entry. All fields optional. */
export type TenderlyTokenInfo = {
  standard?: string
  contract_address?: string
  symbol?: string
  name?: string
  logo?: string
  decimals?: number
}

/**
 * A single asset change from Tenderly's `transaction_info.asset_changes[]`.
 * Every field is optional — Tenderly omits fields depending on the token
 * standard and the change type, so consumers must treat all of them as
 * best-effort.
 */
export type TenderlyAssetChange = {
  type?: string
  from?: string
  to?: string
  amount?: string
  raw_amount?: string
  dollar_value?: string
  token_info?: TenderlyTokenInfo
}

/** A raw EVM log as reported inside `transaction_info.logs[].raw`. */
export type TenderlyRawLog = {
  address: string
  topics: string[]
  data: string
}

/**
 * A narrowed, still-raw subset of the Tenderly simulation response. The logic
 * component is responsible for turning this into the normalized DTO.
 */
export type TenderlySimulationResult = {
  /** `false` means the transaction would revert. */
  status: boolean
  /** Revert reason when the transaction fails, otherwise `null`. */
  errorMessage: string | null
  /** Asset transfers/mints/burns detected by Tenderly (ERC20/721 reliably). */
  assetChanges: TenderlyAssetChange[]
  /** Approval-related exposure changes (shape undocumented — passed through raw). */
  exposureChanges: unknown[]
  /** Raw EVM logs, used as the primary source for decoding approvals and ERC1155 transfers. */
  rawLogs: TenderlyRawLog[]
  /** Net per-address USD balance deltas reported by Tenderly (addresses lowercased). */
  balanceChanges: Array<{ address: string; dollarValue: string | null }>
  /** Decoded event log names alongside their emitting contract (addresses lowercased, capped). */
  events: Array<{ name: string | null; address: string }>
}

/** Parameters for a single Tenderly simulation call. */
export type TenderlySimulateParams = {
  /** EVM chain id as a decimal string (e.g. `'137'`). */
  networkId: string
  /** Sender address (`0x…`). */
  from: string
  /** Target contract/address (`0x…`). */
  to: string
  /** Transaction calldata (`0x…`). Sensitive — never logged. */
  input: string
  /** Wei value as a decimal string. */
  value: string
}

export type ITenderlyAdapter = {
  /**
   * Runs a `simulation_type: 'full'` simulation against Tenderly and returns a
   * narrowed raw subset of the response. Throws `TenderlyAuthError` /
   * `TenderlyBadRequestError` / `TenderlyRateLimitError` /
   * `TenderlyUnavailableError`.
   */
  simulate(params: TenderlySimulateParams): Promise<TenderlySimulationResult>
}
