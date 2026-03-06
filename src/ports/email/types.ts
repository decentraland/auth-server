import { IBaseComponent } from '@well-known-components/interfaces'

export type SendNudgeParams = {
  to: string
  checkpointId: number
  sequence: 1 | 2 | 3
  metadata?: Record<string, unknown>
}

export type IEmailComponent = IBaseComponent & {
  sendNudge(params: SendNudgeParams): Promise<string | undefined>
}
