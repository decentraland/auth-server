import { ethers } from 'ethers'
import { v4 as uuid } from 'uuid'
import { Authenticator } from '@dcl/crypto'
import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { validateAuthChain } from '../../logic/auth-chain'
import { isErrorWithMessage } from '../../logic/error-handling'
import { IDENTITY_VERIFIER_HEADER, isValidIdentityVerifier } from '../../logic/identity-verifier'
import { ONE_HOUR_IN_MILLISECONDS } from '../../ports/server/constants'
import { IdentityIdValidationResponse, IdentityResponse, InvalidResponseMessage } from '../../ports/server/types'
import { validateIdentityId, validateIdentityRequest } from '../../ports/server/validations'
import { HandlerContextWithPath } from '../../types'
import { formatIpHeaders, getClientIp } from '../utils'

// POST /identities — store identity (protected by signed-fetch middleware)
export async function createIdentityHandler(
  context: HandlerContextWithPath<'storage' | 'logs' | 'l1Provider', '/identities'> & DecentralandSignatureContext
) {
  const {
    components: { storage, logs, l1Provider },
    request,
    verification
  } = context

  const identityLogger = logs.getLogger('identity-endpoints')
  identityLogger.log('Received a request to create identity')

  try {
    const body = await request.json()
    const { identity, isMobile, authRequestId } = validateIdentityRequest(body)

    if (!identity) {
      identityLogger.log('Received a request to create identity without AuthIdentity in body')
      return {
        status: 400,
        body: { error: 'AuthIdentity is required in request body' } satisfies InvalidResponseMessage
      }
    }

    // Validate auth chain using the same logic as /requests endpoint
    let identitySender: string
    try {
      const { sender, finalAuthority } = await validateAuthChain(identity.authChain, l1Provider)
      identitySender = sender
      // Verify that the ephemeral wallet address matches the finalAuthority from auth chain
      if (identity.ephemeralIdentity.address.toLowerCase() !== finalAuthority.toLowerCase()) {
        identityLogger.log(`Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender}`)
        return {
          status: 403,
          body: { error: 'Ephemeral wallet address does not match auth chain final authority' } satisfies InvalidResponseMessage
        }
      }

      // Verify that the user making the request is the same as the one who signed the identity
      const requestSender = verification?.auth
      if (!requestSender || requestSender.toLowerCase() !== identitySender.toLowerCase()) {
        identityLogger.log(`Request sender (${requestSender}) does not match identity owner (${identitySender})`)
        return {
          status: 403,
          body: { error: 'Request sender does not match identity owner' } satisfies InvalidResponseMessage
        }
      }

      const wallet = new ethers.Wallet(identity.ephemeralIdentity.privateKey)

      if (wallet.address.toLowerCase() !== identity.ephemeralIdentity.address.toLowerCase()) {
        identityLogger.log(`Ephemeral private key does not match the provided address for sender: ${identitySender}`)
        return {
          status: 403,
          body: { error: 'Ephemeral private key does not match the provided address' } satisfies InvalidResponseMessage
        }
      }
    } catch (e) {
      const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'
      identityLogger.log(`Received a request to create identity with invalid auth chain: ${errorMessage}`)
      return {
        status: 400,
        body: { error: errorMessage } satisfies InvalidResponseMessage
      }
    }

    const identityId = uuid()
    // Always use a 1 hour expiration for storage (controls when identity is removed from storage)
    const storageExpiration = new Date(Date.now() + ONE_HOUR_IN_MILLISECONDS)
    const clientIp = getClientIp(request.headers)

    await storage.setIdentity(identityId, {
      identityId,
      identity,
      expiration: storageExpiration,
      createdAt: new Date(),
      ipAddress: clientIp,
      isMobile: isMobile === true,
      ...(authRequestId ? { authRequestId: authRequestId.toLowerCase() } : {})
    })

    await storage.setIdentityStatus(identityId, {
      expiration: storageExpiration,
      createdAt: new Date(),
      consumed: false,
      signer: identitySender
    })

    identityLogger.log(
      `[IID:${identityId}][SIGNER:${identitySender}][EXP:${storageExpiration.getTime()}][Mobile:${
        isMobile === true
      }] Successfully created identity from IP: ${clientIp}. Headers: ${formatIpHeaders(request.headers)}`
    )

    return {
      status: 201,
      body: { identityId, expiration: storageExpiration } satisfies IdentityResponse
    }
  } catch (e) {
    const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'
    identityLogger.log(`Received a request to create identity with invalid message: ${errorMessage}`)
    return {
      status: 400,
      body: { error: errorMessage } satisfies InvalidResponseMessage
    }
  }
}

export type GetIdentityOptions = {
  /** Rejects identities bound to an authRequestId when the request has no verifier. Off while older clients don't send one. */
  requireIdentityVerifier: boolean
}

// GET /identities/:id — returns identity for auto-login
export function createGetIdentityHandler({ requireIdentityVerifier }: GetIdentityOptions) {
  return async function getIdentityHandler(context: HandlerContextWithPath<'storage' | 'logs', '/identities/:id'>) {
    const {
      params: { id: identityId },
      components: { storage, logs },
      request
    } = context

    const identityLogger = logs.getLogger('identity-endpoints')
    identityLogger.log(`Received a request to retrieve identity: ${identityId}`)

    if (!validateIdentityId(identityId)) {
      identityLogger.log(`[IID:${identityId}] Received a request to retrieve identity with invalid format`)
      return { status: 400, body: { error: 'Invalid identity format' } satisfies InvalidResponseMessage }
    }

    const identity = await storage.getIdentity(identityId)

    if (!identity) {
      const status = await storage.getIdentityStatus(identityId)
      if (status) {
        if (status.deletionReason === 'consumed') {
          identityLogger.log(`[IID:${identityId}][SIGNER:${status.signer}] Received a request to retrieve an already consumed identity`)
          return { status: 404, body: { error: 'Identity was already consumed' } satisfies InvalidResponseMessage }
        }
        if (status.deletionReason === 'expired') {
          identityLogger.log(`[IID:${identityId}][SIGNER:${status.signer}] Received a request to retrieve an expired identity`)
          return { status: 404, body: { error: 'Identity has expired' } satisfies InvalidResponseMessage }
        }
        // Tombstone exists but no deletion reason → identity was evicted from cache by Redis TTL
        identityLogger.log(
          `[IID:${identityId}][SIGNER:${
            status.signer
          }][CREATED:${status.createdAt.toISOString()}] Received a request to retrieve an identity evicted by TTL`
        )
        return {
          status: 404,
          body: { error: 'Identity was evicted', createdAt: status.createdAt.toISOString() }
        }
      }
      identityLogger.log(`[IID:${identityId}] Received a request to retrieve a non-existent identity`)
      return { status: 404, body: { error: 'Identity not found' } satisfies InvalidResponseMessage }
    }

    const signer = Authenticator.ownerAddress(identity.identity.authChain)

    if (identity.expiration < new Date()) {
      await storage.deleteIdentity(identityId)
      await storage.updateIdentityStatus(identityId, { consumed: false, deletionReason: 'expired' })
      identityLogger.log(`[IID:${identityId}][SIGNER:${signer}] Received a request to retrieve an expired identity`)
      return { status: 410, body: { error: 'Identity has expired' } satisfies InvalidResponseMessage }
    }

    const clientIp = getClientIp(request.headers)

    // Identities bound to an authRequestId are only served to the client holding the verifier it was derived from.
    // A failed check keeps the identity, so a leaked id cannot burn the real login.
    if (identity.authRequestId) {
      const verifier = request.headers.get(IDENTITY_VERIFIER_HEADER)
      if (verifier ? !isValidIdentityVerifier(verifier, identity.authRequestId) : requireIdentityVerifier) {
        identityLogger.log(
          `[IID:${identityId}][SIGNER:${signer}] Received a request to retrieve identity with a ${
            verifier ? 'invalid' : 'missing'
          } verifier from IP: ${clientIp}`
        )
        return { status: 401, body: { error: 'Invalid identity verifier' } satisfies InvalidResponseMessage }
      }
      if (!verifier) {
        identityLogger.log(`[IID:${identityId}][SIGNER:${signer}] Serving identity without a verifier (not yet required)`)
      }
    }

    try {
      // Delete the identity from the storage
      await storage.deleteIdentity(identityId)
      await storage.updateIdentityStatus(identityId, { consumed: true, deletionReason: 'consumed' })

      identityLogger.log(
        `[IID:${identityId}][SIGNER:${signer}][EXP:${identity.expiration.getTime()}] Successfully served identity to IP: ${clientIp}`
      )

      // Return the identity for auto-login
      return {
        status: 200,
        body: { identity: identity.identity } satisfies IdentityIdValidationResponse
      }
    } catch (error) {
      const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
      identityLogger.error(`[IID:${identityId}][SIGNER:${signer}] Error serving identity: ${errorMessage}`)
      return { status: 500, body: { error: 'Internal server error' } satisfies InvalidResponseMessage }
    }
  }
}
