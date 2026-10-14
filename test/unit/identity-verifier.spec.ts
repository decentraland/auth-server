import { deriveAuthRequestId, isValidIdentityVerifier } from '../../src/logic/identity-verifier'

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const AUTH_REQUEST_ID = '13d31e96-1a1a-48ec-af16-b10c4c982e08'

describe('when deriving an auth request id from a verifier', () => {
  let verifier: string

  describe('and the verifier is well formed', () => {
    beforeEach(() => {
      verifier = VERIFIER
    })

    it('should return the UUID v4 matching the shared test vector', () => {
      expect(deriveAuthRequestId(verifier)).toBe(AUTH_REQUEST_ID)
    })
  })

  describe('and the verifier is too short', () => {
    beforeEach(() => {
      verifier = VERIFIER.slice(0, 42)
    })

    it('should return null', () => {
      expect(deriveAuthRequestId(verifier)).toBeNull()
    })
  })

  describe('and the verifier has characters outside base64url', () => {
    beforeEach(() => {
      verifier = `${VERIFIER.slice(0, 42)}+`
    })

    it('should return null', () => {
      expect(deriveAuthRequestId(verifier)).toBeNull()
    })
  })
})

describe('when validating an identity verifier', () => {
  let verifier: string
  let authRequestId: string

  describe('and the verifier derives the stored auth request id', () => {
    beforeEach(() => {
      verifier = VERIFIER
      authRequestId = AUTH_REQUEST_ID
    })

    it('should be valid', () => {
      expect(isValidIdentityVerifier(verifier, authRequestId)).toBe(true)
    })
  })

  describe('and the stored auth request id is uppercased', () => {
    beforeEach(() => {
      verifier = VERIFIER
      authRequestId = AUTH_REQUEST_ID.toUpperCase()
    })

    it('should be valid', () => {
      expect(isValidIdentityVerifier(verifier, authRequestId)).toBe(true)
    })
  })

  describe('and the verifier derives a different auth request id', () => {
    beforeEach(() => {
      verifier = `${VERIFIER.slice(0, 42)}A`
      authRequestId = AUTH_REQUEST_ID
    })

    it('should be invalid', () => {
      expect(isValidIdentityVerifier(verifier, authRequestId)).toBe(false)
    })
  })

  describe('and the verifier is malformed', () => {
    beforeEach(() => {
      verifier = 'not-a-verifier'
      authRequestId = AUTH_REQUEST_ID
    })

    it('should be invalid', () => {
      expect(isValidIdentityVerifier(verifier, authRequestId)).toBe(false)
    })
  })
})
