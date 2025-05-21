import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { IReferralComponent, ReferralError } from './types'

export async function createReferralComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IReferralComponent> {
  const logger = logs.getLogger('referral-server')
  const referralServerUrl = await config.requireString('REFERRAL_SERVER_URL')
  const apiKey = await config.requireString('REFERRAL_SERVER_API_KEY')

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
        logger.error(`Error updating user ${invitedUserAddress} referral: ${error}`)
      }
    } catch (error: unknown) {
      const referralError: ReferralError = {
        message: isErrorWithMessage(error) ? error.message : 'Unknown error'
      }
      logger.error('Error updating referral', { error: referralError.message, invitedUserAddress })
    }
  }

  return {
    updateReferral
  }
}
