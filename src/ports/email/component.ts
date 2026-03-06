import sgMail from '@sendgrid/mail'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { IEmailComponent, SendNudgeParams } from './types'

// Index 0 is unused — checkpoint IDs start at 1.
// prettier-ignore
const CHECKPOINT_NAMES = [
  '',                        // 0
  'Authentication Started',  // 1
  'Auth Method Selected',    // 2
  'Profile Creation',        // 3
  'Avatar Creator Started',  // 4
  'Download Page Viewed',    // 5
  'Download Clicked',        // 6
  'Launcher Ready'           // 7
]

// prettier-ignore
const CHECKPOINT_HINTS = [
  '',                                                                                                                      // 0
  "You started signing up for Decentraland. Just choose a sign-in method and you're one step closer to your first adventure.", // 1
  'You selected a sign-in option. Complete the authentication to set up your account.',                                    // 2
  'You were setting up your profile. Just finish your username and accept the terms to get your identity in Decentraland.', // 3
  'You started creating your avatar. Choose your look and make it yours — it only takes a minute.',                        // 4
  'You found the download page. Install the Decentraland client to start exploring.',                                      // 5
  'You downloaded Decentraland. Install it and open the launcher to get in.',                                              // 6
  'You have the launcher ready. Hit Jump In and start your first session in Decentraland.'                                 // 7
]

// prettier-ignore
const SEQUENCE_SUBJECTS = [
  '',                                                                    // 0
  "You're almost there — finish setting up your Decentraland account",   // 1
  "Don't miss out — your Decentraland account is waiting",               // 2
  'Last chance — complete your Decentraland setup'                       // 3
]

// prettier-ignore
const CHECKPOINT_CTA_URLS = [
  '',                                  // 0
  'https://decentraland.org/auth/login', // 1
  'https://decentraland.org/auth/login', // 2
  'https://decentraland.org/auth/login', // 3
  'https://decentraland.org/download',   // 4
  'https://decentraland.org/download',   // 5
  'https://decentraland.org/download',   // 6
  'decentraland://'                      // 7
]

export async function createEmailComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IEmailComponent> {
  const logger = logs.getLogger('email-component')

  const apiKey = await config.requireString('SENDGRID_API_KEY')
  const fromEmail = await config.requireString('SENDGRID_FROM_EMAIL')
  const templateId = await config.requireString('SENDGRID_TEMPLATE_ID')

  sgMail.setApiKey(apiKey)

  const sendNudge = async (params: SendNudgeParams): Promise<string | undefined> => {
    const { to, checkpointId, sequence } = params

    const templateData = {
      checkpointId,
      checkpointName: CHECKPOINT_NAMES[checkpointId] ?? `Checkpoint ${checkpointId}`,
      checkpointHint: CHECKPOINT_HINTS[checkpointId] ?? '',
      ctaUrl: CHECKPOINT_CTA_URLS[checkpointId] ?? 'https://decentraland.org',
      sequence,
      sequenceSubject: SEQUENCE_SUBJECTS[sequence]
    }

    const msg: sgMail.MailDataRequired = {
      to,
      from: fromEmail,
      templateId,
      dynamicTemplateData: templateData
    }

    try {
      const [response] = await sgMail.send(msg)
      const messageId = response.headers['x-message-id']
      logger.log(`[CP:${checkpointId}][TO:${to}][SEQ:${sequence}] Nudge email sent. Message ID: ${messageId}`)
      return messageId
    } catch (e) {
      logger.error(
        `[CP:${checkpointId}][TO:${to}][SEQ:${sequence}] Failed to send nudge email: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`
      )
      return undefined
    }
  }

  return { sendNudge }
}
