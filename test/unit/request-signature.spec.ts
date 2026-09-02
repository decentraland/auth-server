import { keccak256, toUtf8Bytes } from 'ethers'
import { Authenticator } from '@dcl/crypto'
import {
  buildSignedRequestPayload,
  isSignedRequestMessage,
  verifySignedBody,
  verifySignedRequestMessage
} from '../../src/logic/request-signature'
import { REQUEST_SIGNATURE_MAX_AGE_MS } from '../../src/ports/server/constants'
import { createTestIdentity } from '../utils/test-identity'

describe('when verifying a signed request message', () => {
  const method = 'eth_sendTransaction'
  const params = [{ to: '0x0000000000000000000000000000000000000001', data: '0x', value: '0x0' }]
  let now: number
  let signedMessage: { method: string; params: unknown[]; timestamp: number; authChain: ReturnType<typeof Authenticator.signPayload> }
  let owner: string

  beforeEach(async () => {
    now = Date.now()
    const identity = await createTestIdentity()
    owner = identity.authChain[0].payload.toLowerCase()
    const authChain = Authenticator.signPayload(identity, buildSignedRequestPayload(method, params, now))
    signedMessage = { method, params, timestamp: now, authChain }
  })

  describe('and the signature covers the method, params and timestamp', () => {
    it('should resolve the chain owner as the sender', async () => {
      await expect(verifySignedRequestMessage(signedMessage, now)).resolves.toEqual({ sender: owner })
    })
  })

  describe('and the params were changed after signing', () => {
    it('should throw', async () => {
      const tampered = { ...signedMessage, params: [{ ...params[0], to: '0x0000000000000000000000000000000000000002' }] }
      await expect(verifySignedRequestMessage(tampered, now)).rejects.toThrow()
    })
  })

  describe('and the method was changed after signing', () => {
    it('should throw', async () => {
      await expect(verifySignedRequestMessage({ ...signedMessage, method: 'eth_signTypedData_v4' }, now)).rejects.toThrow()
    })
  })

  describe('and the timestamp is older than the allowed window', () => {
    it('should throw a signature expired error', async () => {
      await expect(verifySignedRequestMessage(signedMessage, now + REQUEST_SIGNATURE_MAX_AGE_MS + 1)).rejects.toThrow(
        'Request signature has expired'
      )
    })
  })

  describe('and the auth chain is the plain two-link delegation', () => {
    it('should throw because no link signs the request', async () => {
      const identity = await createTestIdentity()
      const unsigned = { ...signedMessage, authChain: identity.authChain }
      await expect(verifySignedRequestMessage(unsigned, now)).rejects.toThrow()
    })
  })

  describe('and the message has no timestamp', () => {
    it('should not be treated as a signed message', () => {
      expect(isSignedRequestMessage({ method, params, authChain: signedMessage.authChain })).toBe(false)
    })
  })
})

describe('when verifying a signed body', () => {
  const rawBody = '{"method":"eth_sendTransaction","params":[{"to":"0x0000000000000000000000000000000000000001"}]}'

  describe('and the metadata carries the hash of the exact bytes', () => {
    it('should not throw', () => {
      expect(() => verifySignedBody(rawBody, { bodyhash: keccak256(toUtf8Bytes(rawBody)) })).not.toThrow()
    })
  })

  describe('and the hash is uppercase', () => {
    it('should not throw because the comparison is case-insensitive', () => {
      expect(() => verifySignedBody(rawBody, { bodyhash: keccak256(toUtf8Bytes(rawBody)).toUpperCase() })).not.toThrow()
    })
  })

  describe('and the body differs from what was hashed', () => {
    it('should throw', () => {
      expect(() => verifySignedBody(rawBody + ' ', { bodyhash: keccak256(toUtf8Bytes(rawBody)) })).toThrow(
        'Request body does not match the signed metadata'
      )
    })
  })

  describe('and the metadata has no hash', () => {
    it('should throw', () => {
      expect(() => verifySignedBody(rawBody, {})).toThrow('Request body does not match the signed metadata')
      expect(() => verifySignedBody(rawBody, undefined)).toThrow('Request body does not match the signed metadata')
    })
  })
})
