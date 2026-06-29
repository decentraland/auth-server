import { AuthIdentity } from '@dcl/crypto'
import fetch from 'decentraland-crypto-fetch'

export type SignedRequestOptions = {
  method: string
  path: string
  body?: unknown
  identity?: AuthIdentity
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
}

export async function createSignedFetchRequest(baseUrl: string, options: SignedRequestOptions) {
  const { method, path, body, identity, headers, metadata } = options
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    identity: identity,
    metadata: metadata
  })

  return response
}
