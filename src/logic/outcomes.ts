import { Authenticator } from '@dcl/crypto'
import { AuthLinkType } from '@dcl/schemas'
import { OutcomeResponseMessage, SignedHttpOutcomeMessage } from '../ports/server/types'
import { IStorageComponent } from '../ports/storage/types'
import { loadActiveRequest } from './requests'

export class OutcomeAuthorizationError extends Error {
  constructor() {
    super('Invalid or expired outcome authorization')
  }
}

/** Wire format shared with Auth: sorted JSON object keys, unchanged array order/string case. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw new OutcomeAuthorizationError()
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`)
      .join(',')}}`
  }
  const json = JSON.stringify(value)
  if (json === undefined) throw new OutcomeAuthorizationError()
  return json
}

/** Constructs the domain-separated payload signed by the approving ephemeral key. */
export function getOutcomeSignaturePayload(
  requestId: string,
  message: Pick<SignedHttpOutcomeMessage, 'sender' | 'result' | 'error' | 'expiresAt'>
): string {
  const outcome = {
    requestId,
    sender: message.sender,
    expiresAt: message.expiresAt,
    ...('result' in message ? { result: message.result } : { error: message.error })
  }
  return `decentraland-auth-outcome-v1\n${canonicalJson(outcome)}`
}

/**
 * Authenticate the exact outcome for its request, then reserve/persist it once before delivery.
 * HTTP and socket callers share this boundary. The delegated identity proves authorization by
 * that identity, not approval in a particular UI and not on-chain execution.
 * @throws OutcomeAuthorizationError for invalid proof, or a request-state/storage error.
 */
export async function authenticateAndRecordOutcome(storage: IStorageComponent, requestId: string, message: SignedHttpOutcomeMessage) {
  const request = await loadActiveRequest(storage, requestId, { rejectIfHasResponse: true })
  const now = Date.now()
  const owner = Authenticator.ownerAddress(message.authChain)
  if (
    (message.requestId !== undefined && message.requestId !== requestId) ||
    !request.sender ||
    owner.toLowerCase() !== request.sender.toLowerCase() ||
    message.sender.toLowerCase() !== request.sender.toLowerCase() ||
    message.expiresAt <= now ||
    message.expiresAt > now + 65_000 ||
    message.authChain[message.authChain.length - 1]?.type !== AuthLinkType.ECDSA_PERSONAL_SIGNED_ENTITY
  )
    throw new OutcomeAuthorizationError()
  const payload = getOutcomeSignaturePayload(requestId, message)
  const validation = await Authenticator.validateSignature(payload, message.authChain, null)
  if (!validation.ok) throw new OutcomeAuthorizationError()
  // Never forward the proof or accept extraneous fields as part of the application outcome.
  const outcome: OutcomeResponseMessage = {
    requestId,
    sender: message.sender,
    ...('result' in message ? { result: message.result } : { error: message.error })
  }
  return storage.recordOutcome(requestId, outcome, message.expiresAt)
}
