import { v4 as uuid } from 'uuid'
import { isErrorWithMessage } from '../../../logic/error-handling'
import { validateIdentityRequest } from '../../../logic/validations'
import type { IdentityResponse, InvalidResponseMessage } from '../../../ports/server/types'
import { getIpHeaders } from '../../helpers'
import type { HandlerContextWithPath } from '../../types'
import { handleIdentityValidationError } from './identity-error-handler'

export async function createIdentityHandler({
  components: { authChain, identityOperations, ipUtils, logs, storage },
  request,
  verification
}: HandlerContextWithPath<'authChain' | 'identityOperations' | 'ipUtils' | 'logs' | 'storage', '/identities'>) {
  const identityLogger = logs.getLogger('identity-endpoints')
  identityLogger.log('Received a request to create identity')

  try {
    const { identity, isMobile } = validateIdentityRequest(await request.json())

    if (!identity) {
      identityLogger.log('Received a request to create identity without AuthIdentity in body')
      return {
        status: 400,
        body: {
          error: 'AuthIdentity is required in request body'
        } satisfies InvalidResponseMessage
      }
    }

    let identitySender: string | undefined
    try {
      const authChainValidation = await authChain.validateAuthChain(identity.authChain)
      identitySender = identityOperations.validateIdentityChain(identity, authChainValidation, verification?.auth)
    } catch (error) {
      return handleIdentityValidationError(error, identityLogger, identitySender)
    }

    const identityId = uuid()
    const ipHeaders = getIpHeaders(request)
    const clientIp = ipUtils.getClientIp({
      headers: ipHeaders
    })
    const storageIdentity = identityOperations.buildStorageIdentity({
      identityId,
      identity,
      clientIp,
      isMobile
    })
    await storage.setIdentity(identityId, storageIdentity)

    identityLogger.log(
      `[IID:${identityId}][EXP:${storageIdentity.expiration.getTime()}][Mobile:${
        storageIdentity.isMobile === true
      }] Successfully created identity from IP: ${clientIp}`
    )

    return {
      status: 201,
      body: {
        identityId,
        expiration: storageIdentity.expiration
      } satisfies IdentityResponse
    }
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
    identityLogger.log(`Received a request to create identity with invalid message: ${errorMessage}`)
    return {
      status: 400,
      body: {
        error: errorMessage
      } satisfies InvalidResponseMessage
    }
  }
}
