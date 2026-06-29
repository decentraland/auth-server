/** Data extracted from a validated Magic DID token. */
export type DidTokenValidationResult = {
  /** The wallet public address that issued the token, lowercased (`0x…`). */
  address: string
  /** The full issuer DID (`did:ethr:0x…`). */
  issuer: string
  /** Issued-at time, epoch seconds. Used to enforce freshness. */
  iat: number
  /** Unique token id — used as a one-time-use nonce to prevent replay. */
  tid: string
}

/** Response shape of Magic's user deletion endpoint. */
export type MagicDeletionResult = {
  /** Identifiers that matched an active user and were queued for deletion. */
  processed: string[]
  /** Identifiers that did not match an active user. */
  unprocessed: string[]
}

export type IMagicAdapter = {
  /**
   * Validates a Magic DID token offline (signature, expiry, `nbf`, and audience
   * when configured) and returns the issuer address plus replay-protection
   * fields. Throws `MagicTokenInvalidError` / `MagicTokenExpiredError`.
   */
  validateDidToken(didToken: string): DidTokenValidationResult
  /**
   * Requests permanent deletion of the user with the given public address via
   * Magic's GDPR deletion endpoint. Throws `MagicAuthError` /
   * `MagicRateLimitError` / `MagicDeletionError`.
   */
  requestUserDeletion(address: string): Promise<MagicDeletionResult>
}
