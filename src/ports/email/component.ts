import sgMail from '@sendgrid/mail'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { IEmailComponent, SendNudgeParams } from './types'

// ---------------------------------------------------------------------------
// Per-sequence nudge email content (CP2 = authenticated, no CP3 yet)
// ---------------------------------------------------------------------------

type NudgeContent = {
  subject: string
  preheader: string
  heading: string
  body: string
  buttonText: string
  buttonUrl: string
  tagline: string
}

const g = (text: string): string => `<span class="gradient-text">${text}</span>`

const NUDGE_CONTENT = new Map<number, NudgeContent>([
  [
    1,
    {
      subject: 'Your Decentraland account is ready — jump in',
      preheader: 'Open Decentraland and continue where you left off.',
      heading: `Your account is ${g('ready.')}<br>Time to step in.`,
      body:
        '<p style="margin:0 0 14px 0;">You finished signing in but haven\'t entered the world yet.</p>' +
        '<p style="margin:0 0 14px 0;">Decentraland is a place you actually move through. Events are happening, people are exploring, and your avatar is waiting.</p>' +
        '<p style="margin:0;">Open Decentraland and continue.</p>',
      buttonText: 'Open Decentraland',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'One step gets you in.'
    }
  ],
  [
    2,
    {
      subject: 'Still want to explore? The world is live',
      preheader: 'Open Decentraland and join everyone inside.',
      heading: `Something is ${g('happening right now.')}`,
      body:
        '<p style="margin:0 0 14px 0;">Decentraland isn\'t just an account you set up — it\'s a place you show up.</p>' +
        '<p style="margin:0 0 14px 0;">Events are running. Conversations are starting. People are exploring together.</p>' +
        '<p style="margin:0;">You\'re one step away from joining them.</p>',
      buttonText: 'Open Decentraland',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'The world is waiting.'
    }
  ]
])

export async function createEmailComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IEmailComponent> {
  const logger = logs.getLogger('email-component')

  const apiKey = await config.requireString('SENDGRID_API_KEY')
  const fromEmail = await config.requireString('SENDGRID_FROM_EMAIL')
  const templateId = await config.requireString('SENDGRID_TEMPLATE_ID')

  sgMail.setApiKey(apiKey)

  const sendNudge = async (params: SendNudgeParams): Promise<string | undefined> => {
    const { to, sequence } = params

    const content = NUDGE_CONTENT.get(sequence)
    if (!content) {
      logger.error(`[TO:${to}][SEQ:${sequence}] No nudge content for sequence`)
      return undefined
    }

    const dynamicTemplateData = {
      subject: content.subject,
      preheader: content.preheader,
      heading: content.heading,
      body: content.body,
      buttonText: content.buttonText,
      buttonUrl: content.buttonUrl,
      tagline: content.tagline
    }

    const msg: sgMail.MailDataRequired = {
      to,
      from: fromEmail,
      templateId,
      dynamicTemplateData
    }

    try {
      const [response] = await sgMail.send(msg)
      const messageId = response.headers['x-message-id']
      logger.log(`[TO:${to}][SEQ:${sequence}] Nudge email sent. Message ID: ${messageId}`)
      return messageId
    } catch (e) {
      logger.error(`[TO:${to}][SEQ:${sequence}] Failed to send nudge email: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
      return undefined
    }
  }

  return { sendNudge }
}
