import { AppComponents } from '../../types'
import { isErrorWithMessage } from '../error-handling'
import { AddressMismatchError, DidTokenReusedError, DidTokenStaleError } from './errors'
import { DeleteAccountParams, DeleteAccountResult, IAccountDeletionComponent } from './types'

// Extra TTL beyond the freshness window kept for the one-time `tid` record, to
// absorb clock skew between the client and server.
const TID_TTL_BUFFER_SECONDS = 60

export function createAccountDeletionComponent({
  magic,
  storage,
  onboarding,
  logs,
  didTokenMaxAgeSeconds
}: Pick<AppComponents, 'magic' | 'storage' | 'onboarding' | 'logs'> & {
  didTokenMaxAgeSeconds: number
}): IAccountDeletionComponent {
  const logger = logs.getLogger('account-deletion')

  const deleteAccount = async ({ signedFetchAddress, didToken, ip }: DeleteAccountParams): Promise<DeleteAccountResult> => {
    // 1. Validate the Magic DID token offline (signature, expiry, audience).
    //    Throws MagicTokenInvalidError / MagicTokenExpiredError.
    const { address, iat, tid } = magic.validateDidToken(didToken)

    // 2. The Magic session holder must be the same address that signed the DCL
    //    request — both layers must agree on one account.
    if (address !== signedFetchAddress.toLowerCase()) {
      throw new AddressMismatchError()
    }

    // 3. The token must have been minted recently, approximating "the user just
    //    clicked Confirm" and bounding any replay window.
    const ageSeconds = Math.floor(Date.now() / 1000) - iat
    if (ageSeconds > didTokenMaxAgeSeconds) {
      throw new DidTokenStaleError(`DID token is too old (${ageSeconds}s > ${didTokenMaxAgeSeconds}s)`)
    }

    // 4. One-time use: reject replays of the same token id. Consumed before the
    //    side-effecting call so a replay cannot trigger a second deletion.
    const isFresh = await storage.consumeDidTokenId(tid, didTokenMaxAgeSeconds + TID_TTL_BUFFER_SECONDS)
    if (!isFresh) {
      throw new DidTokenReusedError()
    }

    // 5. Permanently delete the Magic account by public address (irreversible).
    const result = await magic.requestUserDeletion(address)

    // 6. Purge local PII. The irreversible Magic deletion has already happened,
    //    so a purge failure must not fail the request — log it (idempotent retry).
    try {
      await onboarding.deleteByWallet(address)
    } catch (e) {
      logger.error(`[ADDR:${address}] Magic account deleted but local purge failed: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    }

    // 7. Audit trail for an irreversible action.
    logger.log(
      `[ADDR:${address}][IP:${ip ?? 'unknown'}] Account deletion requested via Magic. processed=${result.processed.length} unprocessed=${
        result.unprocessed.length
      }`
    )

    return { address, magic: result }
  }

  return { deleteAccount }
}
