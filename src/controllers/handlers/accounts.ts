import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { MagicRateLimitError, MagicTokenExpiredError, MagicTokenInvalidError } from '../../adapters/magic'
import { AddressMismatchError, DidTokenReusedError, DidTokenStaleError } from '../../logic/account-deletion'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AccountDeletionMetadata, AccountDeletionResponse, InvalidResponseMessage } from '../../ports/server/types'
import { validateAccountDeletionMetadata } from '../../ports/server/validations'
import { HandlerContextWithPath } from '../../types'
import { getClientIp } from '../utils'

// DELETE /accounts — permanently deletes the user's Magic account (irreversible) and
// purges local PII. Layered auth: DCL signed-fetch (verification.auth) + a fresh Magic
// DID token, cross-checked to the same address. The signed-fetch middleware is applied
// in the router before this handler runs.
//
// `accountDeletionAllowedOrigins` is an exact-match allowlist of browser Origins permitted
// to call this endpoint (defense-in-depth on top of CORS). Empty disables the check.
export function createDeleteAccountHandler(accountDeletionAllowedOrigins: Set<string>) {
  return async function deleteAccountHandler(
    context: HandlerContextWithPath<'accountDeletion' | 'logs', '/accounts'> & DecentralandSignatureContext
  ) {
    const {
      components: { accountDeletion, logs },
      request,
      verification
    } = context

    const deletionLogger = logs.getLogger('account-deletion-endpoint')

    // Defense-in-depth: restrict to official Decentraland browser origins.
    const rawOrigin = request.headers.get('origin') || ''
    const origin = rawOrigin.toLowerCase()
    if (accountDeletionAllowedOrigins.size > 0 && (!origin || !accountDeletionAllowedOrigins.has(origin))) {
      deletionLogger.log(`Rejected account deletion from disallowed origin: ${request.headers.get('origin') ?? 'none'}`)
      return { status: 403, body: { error: 'Origin not allowed' } satisfies InvalidResponseMessage }
    }

    // The DID token travels in the signed-fetch metadata, so it is covered by
    // the request signature (method:path:timestamp:metadata) — no request body.
    let metadata: AccountDeletionMetadata
    try {
      metadata = validateAccountDeletionMetadata(verification?.authMetadata)
    } catch (e) {
      return { status: 400, body: { error: isErrorWithMessage(e) ? e.message : 'Unknown error' } satisfies InvalidResponseMessage }
    }

    const requestSender = verification?.auth
    if (!requestSender) {
      return { status: 401, body: { error: 'Request signer is required' } satisfies InvalidResponseMessage }
    }

    try {
      const result = await accountDeletion.deleteAccount({
        signedFetchAddress: requestSender,
        didToken: metadata.didToken,
        ip: getClientIp(request.headers)
      })

      return {
        status: 200,
        body: { deleted: true, address: result.address, magic: result.magic } satisfies AccountDeletionResponse
      }
    } catch (e) {
      const message = isErrorWithMessage(e) ? e.message : 'Unknown error'

      if (e instanceof MagicTokenInvalidError || e instanceof MagicTokenExpiredError) {
        deletionLogger.log(`Rejected account deletion: invalid DID token: ${message}`)
        return { status: 401, body: { error: message } satisfies InvalidResponseMessage }
      }

      if (e instanceof AddressMismatchError || e instanceof DidTokenStaleError || e instanceof DidTokenReusedError) {
        deletionLogger.log(`Rejected account deletion: ${message}`)
        return { status: 403, body: { error: message } satisfies InvalidResponseMessage }
      }

      if (e instanceof MagicRateLimitError) {
        deletionLogger.log(`Account deletion rate limited by Magic: ${message}`)
        return { status: 429, body: { error: message } satisfies InvalidResponseMessage }
      }

      // MagicAuthError (our misconfig), MagicDeletionError, and anything else.
      deletionLogger.error(`Account deletion failed: ${message}`)
      return { status: 500, body: { error: 'Internal server error' } satisfies InvalidResponseMessage }
    }
  }
}
