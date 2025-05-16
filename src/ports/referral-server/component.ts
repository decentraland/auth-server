import { AppComponents } from '../../types'
import { IReferralServerComponent, ReferralError } from './types'

export async function createReferralServerComponent({
  config,
  logs
}: Pick<AppComponents, 'config' | 'logs'>): Promise<IReferralServerComponent> {
  const logger = logs.getLogger('referral-server')
  const referralServerUrl = await config.requireString('REFERRAL_SERVER_URL')
  const apiKey = await config.requireString('REFERRAL_SERVER_API_KEY')

  const createReferral = async (referrer: string, invitedUser: string): Promise<void> => {
    try {
      const response = await fetch(`${referralServerUrl}/referral-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          referrer: referrer.toLowerCase(),
          invited_user: invitedUser.toLowerCase()
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to create referral: ${error}`)
      }

      if (response.status !== 204) {
        throw new Error(`Unexpected status code: ${response.status}`)
      }
    } catch (error: unknown) {
      const referralError: ReferralError = {
        message: error instanceof Error ? error.message : String(error)
      }
      logger.error('Error creating referral', { error: referralError.message, referrer, invitedUser })
      throw referralError
    }
  }

  const updateReferral = async (invitedUserAddress: string): Promise<void> => {
    try {
      const response = await fetch(`${referralServerUrl}/referral-progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          invited_user: invitedUserAddress.toLowerCase()
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to update referral: ${error}`)
      }

      if (response.status !== 204) {
        throw new Error(`Unexpected status code: ${response.status}`)
      }
    } catch (error: unknown) {
      const referralError: ReferralError = {
        message: error instanceof Error ? error.message : String(error)
      }
      logger.error('Error updating referral', { error: referralError.message, invitedUserAddress })
      throw referralError
    }
  }

  return {
    createReferral,
    updateReferral
  }
}
