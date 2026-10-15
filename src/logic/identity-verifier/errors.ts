/**
 * The identity is bound to an `authRequestId` and the request's verifier does not match it, or is
 * missing while required. Maps to HTTP 401; the identity is kept.
 */
export class InvalidIdentityVerifierError extends Error {
  constructor(public readonly reason: 'invalid' | 'missing') {
    super(reason === 'invalid' ? 'Invalid identity verifier' : 'Missing identity verifier')
    this.name = 'InvalidIdentityVerifierError'
  }
}
