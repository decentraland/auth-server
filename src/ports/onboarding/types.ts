import { IBaseComponent } from '@well-known-components/interfaces'

export type IdentifierType = 'anon' | 'email' | 'wallet'
export type CheckpointAction = 'reached' | 'completed'

export type CheckpointPayload = {
  userIdentifier: string
  identifierType: IdentifierType
  checkpointId: number
  action: CheckpointAction
  email?: string
  wallet?: string
  source?: string
  metadata?: Record<string, unknown>
}

export type PendingNudge = {
  userId: string
  email: string
}

export type IOnboardingComponent = IBaseComponent & {
  recordCheckpoint(payload: CheckpointPayload): Promise<void>
  getPendingNudges(sequence: 1 | 2): Promise<PendingNudge[]>
  markNudgeSent(userId: string, sequence: 1 | 2, messageId?: string): Promise<void>
}
