/**
 * The address recovered from the Magic DID token does not match the address that
 * signed the DCL signed-fetch request. Maps to HTTP 403.
 */
export class AddressMismatchError extends Error {
  constructor(message = 'DID token address does not match the request signer') {
    super(message)
    this.name = 'AddressMismatchError'
  }
}

/**
 * The DID token was not minted recently enough to be considered a deliberate,
 * fresh deletion action. Maps to HTTP 403.
 */
export class DidTokenStaleError extends Error {
  constructor(message = 'DID token is stale') {
    super(message)
    this.name = 'DidTokenStaleError'
  }
}

/**
 * The DID token id (`tid`) has already been used — replay attempt. Maps to HTTP 403.
 */
export class DidTokenReusedError extends Error {
  constructor(message = 'DID token has already been used') {
    super(message)
    this.name = 'DidTokenReusedError'
  }
}
