import { Magic, SDKError, ErrorCode } from '@magic-sdk/admin'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { MagicAuthError, MagicDeletionError, MagicRateLimitError, MagicTokenExpiredError, MagicTokenInvalidError } from './errors'
import { DidTokenValidationResult, IMagicAdapter, MagicDeletionResult } from './types'

// Magic's GDPR deletion endpoint (see docs.magic.link .../data/deletion-request).
// Note: this lives on api.magic.link, which differs from the admin SDK's default
// host, so the call is made directly with the fetch component.
const DELETION_PATH = '/v1/admin/user/deletion/request'
const DEFAULT_API_URL = 'https://api.magic.link'

export async function createMagicAdapter({
  config,
  logs,
  fetch
}: Pick<AppComponents, 'config' | 'logs' | 'fetch'>): Promise<IMagicAdapter> {
  const logger = logs.getLogger('magic-adapter')

  // Secret key is required and sensitive — never log it or the DID tokens.
  const secretKey = await config.requireString('MAGIC_SECRET_KEY')
  const apiUrl = (await config.getString('MAGIC_API_URL')) || DEFAULT_API_URL
  // Required: token validation enforces the DID token `aud` against this app's client id.
  const clientId = await config.requireString('MAGIC_CLIENT_ID')

  const baseUrl = apiUrl.replace(/\/+$/, '')

  // Constructed (not `Magic.init`) on purpose: the constructor performs no
  // network call, so token validation stays fully offline and the server has no
  // startup dependency on Magic. Passing `clientId` enables the offline audience check.
  const magic = new Magic(secretKey, { clientId })

  const validateDidToken = (didToken: string): DidTokenValidationResult => {
    try {
      magic.token.validate(didToken)
    } catch (e) {
      if (e instanceof SDKError && (e.code === ErrorCode.TokenExpired || e.code === ErrorCode.TokenCannotBeUsedYet)) {
        throw new MagicTokenExpiredError(e.message)
      }
      throw new MagicTokenInvalidError(isErrorWithMessage(e) ? e.message : 'Invalid Magic DID token')
    }

    const [, claim] = magic.token.decode(didToken)
    const address = magic.token.getPublicAddress(didToken).toLowerCase()

    return { address, issuer: claim.iss, iat: claim.iat, tid: claim.tid }
  }

  const requestUserDeletion = async (address: string): Promise<MagicDeletionResult> => {
    const response = await fetch.fetch(`${baseUrl}${DELETION_PATH}`, {
      method: 'POST',
      headers: {
        'X-Magic-Secret-Key': secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ public_addresses: [address] })
    })

    if (response.status === 401) {
      // Drain the body so undici releases the socket back to the pool before throwing.
      await response.body?.cancel().catch(() => undefined)
      throw new MagicAuthError('Magic rejected the secret key (401)')
    }

    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined)
      throw new MagicRateLimitError('Magic deletion rate limit exceeded (429)')
    }

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 500)
      } catch {
        // ignore body read errors
      }
      throw new MagicDeletionError(`Magic deletion failed with status ${response.status}${detail ? `: ${detail}` : ''}`)
    }

    const data = (await response.json()) as Partial<MagicDeletionResult>

    return {
      processed: Array.isArray(data.processed) ? data.processed : [],
      unprocessed: Array.isArray(data.unprocessed) ? data.unprocessed : []
    }
  }

  logger.log(`Magic adapter ready (apiUrl=${baseUrl})`)

  return { validateDidToken, requestUserDeletion }
}
