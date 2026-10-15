import { IConfigComponent } from '@well-known-components/interfaces'
import {
  createIdentityVerifierComponent,
  IIdentityVerifierComponent,
  InvalidIdentityVerifierError
} from '../../src/logic/identity-verifier'

// Shared with the Explorer and the auth web app tests.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const AUTH_REQUEST_ID = '13d31e96-1a1a-48ec-af16-b10c4c982e08'

function createMockConfig(requireIdentityVerifier?: string): IConfigComponent {
  return { getString: jest.fn().mockResolvedValue(requireIdentityVerifier) } as unknown as IConfigComponent
}

describe('when verifying an identity retrieval', () => {
  let identityVerifier: IIdentityVerifierComponent
  let authRequestId: string | undefined
  let verifier: string | null

  beforeEach(async () => {
    identityVerifier = await createIdentityVerifierComponent({ config: createMockConfig() })
  })

  describe('and the identity has no authRequestId', () => {
    beforeEach(() => {
      authRequestId = undefined
      verifier = VERIFIER
    })

    it('should return false so the caller keeps the IP check', () => {
      expect(identityVerifier.verifyRetrieval(authRequestId, verifier)).toBe(false)
    })
  })

  describe('and the identity has an authRequestId', () => {
    beforeEach(() => {
      authRequestId = AUTH_REQUEST_ID
    })

    describe('and the verifier matches the shared test vector', () => {
      beforeEach(() => {
        verifier = VERIFIER
      })

      it('should return true', () => {
        expect(identityVerifier.verifyRetrieval(authRequestId, verifier)).toBe(true)
      })
    })

    describe('and the stored authRequestId is uppercase', () => {
      beforeEach(() => {
        authRequestId = AUTH_REQUEST_ID.toUpperCase()
        verifier = VERIFIER
      })

      it('should return true', () => {
        expect(identityVerifier.verifyRetrieval(authRequestId, verifier)).toBe(true)
      })
    })

    describe('and the verifier is well formed but does not match', () => {
      beforeEach(() => {
        verifier = `${VERIFIER.slice(0, 42)}A`
      })

      it('should throw an invalid verifier error', () => {
        expect(() => identityVerifier.verifyRetrieval(authRequestId, verifier)).toThrow(new InvalidIdentityVerifierError('invalid'))
      })
    })

    describe('and the verifier is too short', () => {
      beforeEach(() => {
        verifier = VERIFIER.slice(0, 42)
      })

      it('should throw an invalid verifier error', () => {
        expect(() => identityVerifier.verifyRetrieval(authRequestId, verifier)).toThrow(new InvalidIdentityVerifierError('invalid'))
      })
    })

    describe('and the verifier has characters outside base64url', () => {
      beforeEach(() => {
        verifier = `${VERIFIER.slice(0, 42)}+`
      })

      it('should throw an invalid verifier error', () => {
        expect(() => identityVerifier.verifyRetrieval(authRequestId, verifier)).toThrow(new InvalidIdentityVerifierError('invalid'))
      })
    })

    describe('and no verifier is sent', () => {
      beforeEach(() => {
        verifier = null
      })

      describe('and the verifier is not required', () => {
        it('should return false so the caller keeps the IP check', () => {
          expect(identityVerifier.verifyRetrieval(authRequestId, verifier)).toBe(false)
        })
      })

      describe('and the verifier is required', () => {
        beforeEach(async () => {
          identityVerifier = await createIdentityVerifierComponent({ config: createMockConfig('true') })
        })

        it('should throw a missing verifier error', () => {
          expect(() => identityVerifier.verifyRetrieval(authRequestId, verifier)).toThrow(new InvalidIdentityVerifierError('missing'))
        })
      })
    })

    describe('and an empty verifier is sent while the verifier is not required', () => {
      beforeEach(() => {
        verifier = ''
      })

      it('should treat it as missing and return false', () => {
        expect(identityVerifier.verifyRetrieval(authRequestId, verifier)).toBe(false)
      })
    })
  })
})
