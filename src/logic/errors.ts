export class EphemeralAddressMismatchError extends Error {
  constructor(public readonly identityAddress: string, public readonly finalAuthority: string) {
    super('Ephemeral wallet address does not match auth chain final authority')
    this.name = 'EphemeralAddressMismatchError'
  }
}

export class RequestSenderMismatchError extends Error {
  constructor(public readonly requestSender: string | undefined, public readonly identitySender: string) {
    super('Request sender does not match identity owner')
    this.name = 'RequestSenderMismatchError'
  }
}

export class EphemeralPrivateKeyMismatchError extends Error {
  constructor(public readonly identityAddress: string) {
    super('Ephemeral private key does not match the provided address')
    this.name = 'EphemeralPrivateKeyMismatchError'
  }
}

export class EphemeralKeyExpiredError extends Error {
  constructor() {
    super('Ephemeral key has expired')
    this.name = 'EphemeralKeyExpiredError'
  }
}
