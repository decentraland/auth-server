import { v4 as uuid } from 'uuid'
import { isErrorWithMessage } from '../../../logic/error-handling'
import { EphemeralAddressMismatchError, EphemeralPrivateKeyMismatchError, RequestSenderMismatchError } from '../../../logic/errors'
import type { IdentityResponse, InvalidResponseMessage } from '../../../ports/server/types'
import { getIpHeaders } from '../../helpers'
import type { HandlerContext } from '../../types'
import { validateIdentityRequest } from '../../validations'

export async function createIdentityHandler(ctx: HandlerContext<'/identities'>) {
  const { components, request, verification } = ctx
  const { authChain, identityOperations, ipUtils, logs, storage } = components
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
      identitySender = authChainValidation.sender
      identityOperations.assertEphemeralAddressMatchesFinalAuthority(identity, authChainValidation.finalAuthority)
      identityOperations.assertRequestSenderMatchesIdentityOwner(verification?.auth, identitySender)
      identityOperations.assertEphemeralPrivateKeyMatchesAddress(identity)
    } catch (error) {
      if (error instanceof EphemeralAddressMismatchError) {
        identityLogger.log(`Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender ?? 'unknown'}`)
        return {
          status: 403,
          body: {
            error: error.message
          } satisfies InvalidResponseMessage
        }
      }

      if (error instanceof RequestSenderMismatchError) {
        identityLogger.log(`Request sender (${verification?.auth}) does not match identity owner (${identitySender ?? 'unknown'})`)
        return {
          status: 403,
          body: {
            error: error.message
          } satisfies InvalidResponseMessage
        }
      }

      if (error instanceof EphemeralPrivateKeyMismatchError) {
        identityLogger.log(`Ephemeral private key does not match the provided address for sender: ${identitySender ?? 'unknown'}`)
        return {
          status: 403,
          body: {
            error: error.message
          } satisfies InvalidResponseMessage
        }
      }

      const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
      identityLogger.log(`Received a request to create identity with invalid auth chain: ${errorMessage}`)
      return {
        status: 400,
        body: {
          error: errorMessage
        } satisfies InvalidResponseMessage
      }
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
