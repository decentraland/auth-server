import { AuthIdentity } from '@dcl/crypto'
import fetch from 'decentraland-crypto-fetch'

export type SignedRequestOptions = {
  method: string
  path: string
  body?: unknown
  identity?: AuthIdentity
  headers?: Record<string, string>
}

export async function createSignedFetchRequest(baseUrl: string, options: SignedRequestOptions) {
  const { method, path, body, identity, headers } = options
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    identity: identity
  })

  return response
}
