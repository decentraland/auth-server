import { MagicDeletionResult } from '../../adapters/magic'

export type DeleteAccountParams = {
  /** Address recovered from the DCL signed-fetch request (`req.auth`). */
  signedFetchAddress: string
  /** Freshly-minted Magic DID token proving a current Magic session. */
  didToken: string
  /** Client IP, for the audit log. */
  ip?: string
}

export type DeleteAccountResult = {
  /** The deleted wallet address (lowercased). */
  address: string
  /** Raw result from Magic's deletion endpoint. */
  magic: MagicDeletionResult
}

export type IAccountDeletionComponent = {
  /**
   * Validates the caller (DID token + signed-fetch cross-check + freshness +
   * one-time use), permanently deletes the Magic account by public address, and
   * purges local PII. Throws typed errors that the controller maps to HTTP codes.
   */
  deleteAccount(params: DeleteAccountParams): Promise<DeleteAccountResult>
}
