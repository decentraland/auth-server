import { IBaseComponent } from '@well-known-components/interfaces'

export interface IReferralServerComponent extends IBaseComponent {
  createReferral(referrer: string, invitedUser: string): Promise<void>
  updateReferral(invitedUserAddress: string): Promise<void>
}

export type ReferralError = {
  message: string
  status?: number
}
