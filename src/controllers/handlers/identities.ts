import { ethers } from 'ethers'
import { v4 as uuid } from 'uuid'
import { Authenticator, AuthLinkType } from '@dcl/crypto'
import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { validateAuthChain } from '../../logic/auth-chain'
import { isErrorWithMessage } from '../../logic/error-handling'
import { ONE_HOUR_IN_MILLISECONDS } from '../../ports/server/constants'
import { IdentityIdValidationResponse, IdentityResponse, InvalidResponseMessage } from '../../ports/server/types'
import { validateIdentityId, validateIdentityRequest } from '../../ports/server/validations'
import { HandlerContextWithPath } from '../../types'
import { formatIpHeaders, getClientIp, getTrustedClientIp, ipsMatch } from '../utils'

// POST /identities — store identity (protected by signed-fetch middleware)
export async function createIdentityHandler(
  context: HandlerContextWithPath<'storage' | 'logs' | 'signatureValidator', '/identities'> & DecentralandSignatureContext
) {
  const {
    components: { storage, logs, signatureValidator },
    request,
    verification
  } = context

  const identityLogger = logs.getLogger('identity-endpoints')
  identityLogger.log('Received a request to create identity')

  try {
    const body = await request.json()
    const { identity, isMobile } = validateIdentityRequest(body)

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
      const requestSender = verification?.auth
      const senderMismatch = (owner: string) => {
        identityLogger.log(`Request sender (${requestSender}) does not match identity owner (${owner})`)
        return {
          status: 403,
          body: { error: 'Request sender does not match identity owner' } satisfies InvalidResponseMessage
        }
      }

      // The signed-fetch middleware is mandatory on this route, so a sender is always present; this
      // is what lets it key the validation budget below.
      if (!requestSender) {
        return senderMismatch(Authenticator.ownerAddress(identity.authChain))
      }

      // Verify that the user making the request is the same as the one who signed the identity
      // before the chain is validated, because this is free and `validateAuthChain` is not: a
      // chain signed by a smart account goes out to the Catalyst and takes a slot from the shared
      // concurrency cap. Without it, any holder of a valid signed-fetch could spend those on
      // chains belonging to arbitrary other accounts.
      //
      // Only a chain that names an owner can be compared this early. `Authenticator.ownerAddress`
      // does not throw on one that doesn't — it answers `Invalid-Owner-Address` — so an empty or
      // malformed chain falls through to `validateAuthChain`, which rejects it with its own 400
      // without reaching the Catalyst.
      const namesOwner = identity.authChain.length > 0 && identity.authChain[0].type === AuthLinkType.SIGNER
      if (namesOwner) {
        const owner = Authenticator.ownerAddress(identity.authChain)
        if (requestSender.toLowerCase() !== owner.toLowerCase()) {
          return senderMismatch(owner)
        }
      }

      // The signed fetch has proved `requestSender`, so the call draws from the authenticated budget,
      // which anonymous callers cannot touch. It is counted against both that account and the trusted
      // client address: accounts cost nothing to create, so the account alone would let one caller
      // mint as many slots as it likes.
      const trustedIp = getTrustedClientIp(request.headers)
      const { sender, finalAuthority } = await validateAuthChain(identity.authChain, signatureValidator, {
        pool: 'authenticated',
        clientKeys: [`account:${requestSender.toLowerCase()}`, ...(trustedIp ? [`ip:${trustedIp}`] : [])]
      })
      identitySender = sender

      // Re-checked against the validated owner, so correctness never rests on the early check.
      if (requestSender.toLowerCase() !== identitySender.toLowerCase()) {
        return senderMismatch(identitySender)
      }

      // Verify that the ephemeral wallet address matches the finalAuthority from auth chain
      if (identity.ephemeralIdentity.address.toLowerCase() !== finalAuthority.toLowerCase()) {
        identityLogger.log(`Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender}`)
        return {
          status: 403,
          body: { error: 'Ephemeral wallet address does not match auth chain final authority' } satisfies InvalidResponseMessage
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
      isMobile: isMobile === true
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

// GET /identities/:id — returns identity for auto-login
export async function getIdentityHandler(context: HandlerContextWithPath<'storage' | 'logs', '/identities/:id'>) {
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
      if (status.deletionReason === 'ip_mismatch') {
        identityLogger.log(
          `[IID:${identityId}][SIGNER:${status.signer}] Received a request to retrieve an identity deleted due to IP mismatch`
        )
        return { status: 404, body: { error: 'Identity was deleted due to IP mismatch' } satisfies InvalidResponseMessage }
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

  // Validate that the IP address matches the one used when creating the identity
  // Uses flexible matching to handle Cloudflare and VPN edge server differences
  const clientIp = getClientIp(request.headers)

  if (identity.isMobile) {
    // Log header details if IPs differ (for debugging), but allow the request
    if (!ipsMatch(identity.ipAddress, clientIp)) {
      identityLogger.log(
        `[IID:${identityId}][SIGNER:${signer}] Mobile IP mismatch (allowed). Stored: ${
          identity.ipAddress
        }, Request: ${clientIp}. Headers: ${formatIpHeaders(request.headers)}`
      )
    }
    // Continue without blocking for mobile
  } else if (!ipsMatch(identity.ipAddress, clientIp)) {
    // Non-mobile: delete identity and return 403
    await storage.deleteIdentity(identityId)
    await storage.updateIdentityStatus(identityId, { consumed: false, deletionReason: 'ip_mismatch' })
    identityLogger.log(
      `[IID:${identityId}][SIGNER:${signer}] Received a request to retrieve identity from different IP. Stored: ${identity.ipAddress}, Request: ${clientIp}. Identity deleted.`
    )
    return { status: 403, body: { error: 'IP address mismatch' } satisfies InvalidResponseMessage }
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
