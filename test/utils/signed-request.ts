import { AuthIdentity, IdentityType, Authenticator } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'

export type SignedRequestOptions = {
  method: string
  path: string
  body?: unknown
  identity?: AuthIdentity
  realAccount?: IdentityType
  ephemeralIdentity?: IdentityType
}

export async function createSignedRequest(options: SignedRequestOptions): Promise<{
  headers: Record<string, string>
  body?: string
}> {
  const { method, path, body, identity, realAccount, ephemeralIdentity } = options

  // Use provided identity or create a new one
  let authIdentity: AuthIdentity
  let realAcc: IdentityType
  let ephemeral: IdentityType

  if (identity) {
    authIdentity = identity
    // Use the provided real account and ephemeral identity if available
    if (realAccount && ephemeralIdentity) {
      realAcc = realAccount
      ephemeral = ephemeralIdentity
    } else {
      // Extract the real account from the auth chain (first link)
      realAcc = createUnsafeIdentity()
      realAcc.address = authIdentity.authChain[0].payload
      // Extract ephemeral identity from the auth chain
      ephemeral = createUnsafeIdentity()
      // The ephemeral address is in the second link payload
      const ephemeralPayload = authIdentity.authChain[1].payload
      const addressMatch = ephemeralPayload.match(/Ephemeral address: (0x[a-fA-F0-9]{40})/)
      if (addressMatch) {
        ephemeral.address = addressMatch[1]
      }
    }
  } else {
    ephemeral = ephemeralIdentity || createUnsafeIdentity()
    realAcc = realAccount || createUnsafeIdentity()
    authIdentity = await Authenticator.initializeAuthChain(
      realAcc.address,
      ephemeral,
      10, // 10 minutes expiration
      async message => Authenticator.createSignature(realAcc, message)
    )
  }

  // Create the signed request headers
  const timestamp = Date.now()
  const metadata = {}

  // Create the payload that will be signed (this matches what the middleware expects)
  // The middleware expects: [method, path, timestamp, JSON.stringify(metadata)].join(':').toLowerCase()
  const payload = [method, path, timestamp, JSON.stringify(metadata)].join(':').toLowerCase()

  // Use Authenticator.signPayload to create the auth chain for this specific request
  // This adds a third link to the existing auth chain
  const requestAuthChain = Authenticator.signPayload(authIdentity, payload)

  // Build auth chain headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  // Add auth chain headers
  requestAuthChain.forEach((link, index) => {
    headers[`x-identity-auth-chain-${index}`] = JSON.stringify(link)
  })

  // Add other required headers (without leading spaces)
  headers['x-identity-timestamp'] = String(timestamp)
  headers['x-identity-metadata'] = JSON.stringify(metadata)

  return {
    headers,
    body: body ? JSON.stringify(body) : undefined
  }
}

export async function createSignedFetchRequest(
  baseUrl: string,
  options: SignedRequestOptions
): Promise<{
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}> {
  const { method, path } = options
  const { headers, body: signedBody } = await createSignedRequest(options)

  return {
    url: `${baseUrl}${path}`,
    method,
    headers,
    body: signedBody
  }
}
