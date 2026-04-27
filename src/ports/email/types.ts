import { IBaseComponent } from '@well-known-components/interfaces'

export type SendNudgeParams = {
  to: string
  sequence: 1 | 2
  metadata?: Record<string, unknown>
}

export type IEmailComponent = IBaseComponent & {
  sendNudge(params: SendNudgeParams): Promise<string | undefined>
}
