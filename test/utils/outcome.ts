import { AuthIdentity, Authenticator } from '@dcl/crypto'
import { AuthChain, AuthLinkType } from '@dcl/schemas'
import { getOutcomeSignaturePayload } from '../../src/logic/outcomes'
import { OutcomeMessage, SignedOutcomeMessage } from '../../src/ports/server/types'

/** Creates an ordinary signed fixture using the test identity, never a live wallet. */
export function signTestOutcome(identity: AuthIdentity, message: OutcomeMessage): SignedOutcomeMessage {
  const outcome = { ...message, expiresAt: Date.now() + 60_000 }
  return { ...outcome, authChain: Authenticator.signPayload(identity, getOutcomeSignaturePayload(message.requestId, outcome)) }
}

/** Schema-only fixture: cryptographic verification is tested separately with signTestOutcome. */
export function createStubOutcomeProof(): { authChain: AuthChain; expiresAt: number } {
  return {
    expiresAt: Date.now() + 60_000,
    authChain: [
      { type: AuthLinkType.SIGNER, payload: '0x1111111111111111111111111111111111111111', signature: '' },
      { type: AuthLinkType.ECDSA_PERSONAL_EPHEMERAL, payload: 'test delegation', signature: '0x1234' },
      { type: AuthLinkType.ECDSA_PERSONAL_SIGNED_ENTITY, payload: 'test outcome', signature: '0x1234' }
    ]
  }
}
