import { AuthIdentity } from '@dcl/crypto'
import fetch from 'decentraland-crypto-fetch'

export type SignedRequestOptions = {
  method: string
  path: string
  body?: unknown
  identity?: AuthIdentity
}

export async function createSignedFetchRequest(baseUrl: string, options: SignedRequestOptions) {
  const { method, path, body, identity } = options
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    identity: identity
  })

  return response
}
