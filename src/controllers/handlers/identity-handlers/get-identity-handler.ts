import { isErrorWithMessage } from '../../../logic/error-handling'
import type { IdentityIdValidationResponse, InvalidResponseMessage } from '../../../ports/server/types'
import { isValidIdentityId } from '../../../utils/identity-id'
import { getIpHeaders, getPathParam } from '../../helpers'
import type { HandlerContext } from '../../types'

export async function getIdentityHandler(ctx: HandlerContext<'/identities/:id'>) {
  const { components, params, request } = ctx
  const { identityOperations, ipUtils, logs, storage } = components
  const identityLogger = logs.getLogger('identity-endpoints')
  const identityId = getPathParam(params.id, 'id')
  identityLogger.log(`Received a request to retrieve identity: ${identityId}`)

  if (!isValidIdentityId(identityId)) {
    identityLogger.log(`[IID:${identityId}] Received a request to retrieve identity with invalid format`)
    return {
      status: 400,
      body: {
        error: 'Invalid identity format'
      } satisfies InvalidResponseMessage
    }
  }

  const identity = await storage.getIdentity(identityId)

  if (!identity) {
    identityLogger.log(`[IID:${identityId}] Received a request to retrieve a non-existent identity`)
    return {
      status: 404,
      body: {
        error: 'Identity not found'
      } satisfies InvalidResponseMessage
    }
  }

  if (identityOperations.isIdentityExpired(identity)) {
    await storage.deleteIdentity(identityId)
    identityLogger.log(`[IID:${identityId}] Received a request to retrieve an expired identity`)
    return {
      status: 410,
      body: {
        error: 'Identity has expired'
      } satisfies InvalidResponseMessage
    }
  }

  const ipHeaders = getIpHeaders(request)
  const clientIp = ipUtils.getClientIp({
    headers: ipHeaders
  })
  const ipAccessValidation = identityOperations.validateIdentityIpAccess({
    identity,
    clientIp,
    ipsMatchFn: (storedIp, currentIp) => {
      if (storedIp === 'unknown' && currentIp === 'unknown') {
        return true
      }

      return ipUtils.ipsMatch(storedIp, currentIp)
    }
  })

  if (ipAccessValidation.ok && ipAccessValidation.mobileMismatch) {
    identityLogger.log(
      `[IID:${identityId}] Mobile IP mismatch (allowed). Stored: ${
        identity.ipAddress
      }, Request: ${clientIp}. Headers: ${ipUtils.formatIpHeaders(ipHeaders)}`
    )
  } else if (!ipAccessValidation.ok) {
    await storage.deleteIdentity(identityId)
    identityLogger.log(
      `[IID:${identityId}] Received a request to retrieve identity from different IP. Stored: ${identity.ipAddress}, Request: ${clientIp}. Identity deleted.`
    )
    return {
      status: 403,
      body: {
        error: 'IP address mismatch'
      } satisfies InvalidResponseMessage
    }
  }

  try {
    await storage.deleteIdentity(identityId)
    identityLogger.log(`[IID:${identityId}][EXP:${identity.expiration.getTime()}] Successfully served identity to IP: ${clientIp}`)

    return {
      status: 200,
      body: {
        identity: identity.identity
      } satisfies IdentityIdValidationResponse
    }
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
    identityLogger.error(`[IID:${identityId}] Error serving identity: ${errorMessage}`)
    return {
      status: 500,
      body: {
        error: 'Internal server error'
      } satisfies InvalidResponseMessage
    }
  }
}
