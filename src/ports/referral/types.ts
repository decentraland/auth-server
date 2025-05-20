import { IBaseComponent } from '@well-known-components/interfaces'

export interface IReferralComponent extends IBaseComponent {
  updateReferral(invitedUserAddress: string): Promise<void>
}

export type ReferralError = {
  message: string
  status?: number
}
