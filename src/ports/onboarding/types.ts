import { IBaseComponent } from '@well-known-components/interfaces'

export type IdentifierType = 'email' | 'wallet'
export type CheckpointAction = 'reached' | 'completed'

export type CheckpointPayload = {
  userIdentifier: string
  identifierType: IdentifierType
  checkpointId: number
  action: CheckpointAction
  email?: string
  source?: string
  metadata?: Record<string, unknown>
}

export type PendingNudge = {
  userId: string
  checkpointId: number
  email: string
}

export type IOnboardingComponent = IBaseComponent & {
  recordCheckpoint(payload: CheckpointPayload): Promise<void>
  getPendingNudges(sequence: 1 | 2 | 3): Promise<PendingNudge[]>
  markNudgeSent(userId: string, checkpointId: number, sequence: number, messageId?: string): Promise<void>
}
