import { IBaseComponent } from '@well-known-components/interfaces'

export type SendNudgeParams = {
  to: string
  sequence: 1 | 2
}

/**
 * Discriminated union: either the send succeeded (and we have a SendGrid
 * messageId) or it failed (and we have a non-empty error message). The two
 * states are mutually exclusive — `ok` discriminates them at the type level.
 */
export type SendNudgeResult = { ok: true; templateId: string; messageId: string } | { ok: false; templateId: string; error: string }

export type IEmailComponent = IBaseComponent & {
  sendNudge(params: SendNudgeParams): Promise<SendNudgeResult>
}
