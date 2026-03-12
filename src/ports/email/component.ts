import sgMail from '@sendgrid/mail'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { IEmailComponent, SendNudgeParams } from './types'

// ---------------------------------------------------------------------------
// Per-checkpoint, per-sequence nudge email content
// ---------------------------------------------------------------------------

type NudgeContent = {
  subject: string
  preheader: string
  heading: string // HTML — use <br> for line breaks
  body: string // HTML paragraphs
  buttonText: string
  buttonUrl: string
  tagline: string
}

function seqMap(seq1: NudgeContent, seq2: NudgeContent, seq3: NudgeContent): Map<number, NudgeContent> {
  return new Map([
    [1, seq1],
    [2, seq2],
    [3, seq3]
  ])
}

// prettier-ignore
const NUDGE_CONTENT = new Map<number, Map<number, NudgeContent>>([

  // ── CP2 — Auth Method Selected ────────────────────────────────────────────
  [2, seqMap(
    {
      subject: 'Trouble Signing In?',
      preheader: 'You started, but something may have interrupted the process.',
      heading: 'You started signing in,<br>but something cut the process short.',
      body:
        '<p style="margin:0 0 14px 0;">That happens. A window might not have opened. A wallet might not have been ready.</p>' +
        '<p style="margin:0;">Continue with Google is the simplest path in. Continue with MetaMask works if you already have a wallet set up.</p>',
      buttonText: 'Continue Sign Up',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'One step gets you in.'
    },
    {
      subject: 'Your Name Is Waiting',
      preheader: "Finish signing in and choose how you'll appear in Decentraland.",
      heading: "You're one step away<br>from choosing your name.",
      body:
        '<p style="margin:0 0 14px 0;">Once the sign-in finishes, the next step is creating your username.</p>' +
        '<p style="margin:0 0 14px 0;">This is the name people will see when you explore places, join events, or run into someone in Decentraland.</p>' +
        '<p style="margin:0;">You can always change how you show up later. Right now, all you need to do is finish signing in.</p>',
      buttonText: 'Continue Sign Up',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'One step gets you in.'
    },
    {
      subject: 'The World Is Already Active',
      preheader: 'Events, games, and people are waiting inside.',
      heading: 'The world is already active.',
      body:
        "<p style=\"margin:0 0 14px 0;\">Decentraland isn't just something you set up\u2014it's a place people drop into.</p>" +
        '<p style="margin:0 0 14px 0;">Events are happening. Games are running. People are exploring together.</p>' +
        '<p style="margin:0;">You were close to entering. Finish signing in and step into the world.</p>',
      buttonText: 'Continue Sign Up',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'One step gets you in.'
    }
  )],

  // ── CP3 — Profile Creation ────────────────────────────────────────────────
  [3, seqMap(
    {
      subject: 'Finish Choosing Your Name',
      preheader: "You started creating your profile but didn't finish.",
      heading: "You were choosing your name,<br>but didn't finish.",
      body:
        '<p style="margin:0 0 14px 0;">Your username is how people recognize you in Decentraland.</p>' +
        '<p style="margin:0 0 14px 0;">It appears above your avatar when you talk, explore places, or run into someone again later.</p>' +
        "<p style=\"margin:0 0 14px 0;\">It doesn't need to be perfect. Most people change things once they've spent time inside.</p>" +
        '<p style="margin:0;">Right now, just pick something that gets you through the door.</p>',
      buttonText: 'Continue Profile Setup',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'Your name is your first impression.'
    },
    {
      subject: 'Your Name Is How People Find You',
      preheader: 'Finish creating your profile to continue.',
      heading: 'Every place needs a name.',
      body:
        '<p style="margin:0 0 14px 0;">In Decentraland, your username is how people recognize you.</p>' +
        "<p style=\"margin:0 0 14px 0;\">It's what appears when you speak, explore places, or return somewhere later and see familiar faces.</p>" +
        '<p style="margin:0 0 14px 0;">Choose something that feels like you for now. You can always change it later.</p>' +
        "<p style=\"margin:0;\">Once that's done, you'll move on to creating your avatar.</p>",
      buttonText: 'Continue Profile Setup',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'Your name is your first impression.'
    },
    {
      subject: 'People Remember Names',
      preheader: 'Finish creating your profile and step inside.',
      heading: 'People remember who they meet here.',
      body:
        '<p style="margin:0 0 14px 0;">Decentraland is a place where people run into each other.</p>' +
        '<p style="margin:0 0 14px 0;">You recognize avatars. You recognize names. Over time, you start to notice familiar faces.</p>' +
        '<p style="margin:0 0 14px 0;">That all begins with choosing your name.</p>' +
        '<p style="margin:0;">Finish setting up your profile and continue inside.</p>',
      buttonText: 'Continue Profile Setup',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: 'Your name is your first impression.'
    }
  )],

  // ── CP4 — Avatar Creator ──────────────────────────────────────────────────
  [4, seqMap(
    {
      subject: 'Your Avatar Is Almost Ready',
      preheader: "You started creating it but didn't finish.",
      heading: 'Your avatar is waiting<br>to be finished.',
      body:
        "<p style=\"margin:0 0 14px 0;\">You started creating your avatar but didn't complete it.</p>" +
        '<p style="margin:0 0 14px 0;">That\'s normal. This part can feel bigger than it is.</p>' +
        "<p style=\"margin:0 0 14px 0;\">Your first avatar doesn't have to be perfect. Many people change how they look later after they've spent time exploring.</p>" +
        '<p style="margin:0;">For now, just choose something that gets you into the world.</p>',
      buttonText: 'Finish Your Avatar',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: "You're closer than you think."
    },
    {
      subject: 'This Is How People Recognize You',
      preheader: 'Finish your avatar and continue.',
      heading: 'This is how you show up.',
      body:
        '<p style="margin:0 0 14px 0;">Your avatar is how people recognize you when you move through Decentraland.</p>' +
        "<p style=\"margin:0 0 14px 0;\">Clothes, colors, style\u2014it's all flexible. You can change it anytime.</p>" +
        '<p style="margin:0 0 14px 0;">Right now, all you need is a starting point.</p>' +
        '<p style="margin:0;">Finish your avatar and continue.</p>',
      buttonText: 'Finish Your Avatar',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: "You're closer than you think."
    },
    {
      subject: 'Someone Might Recognize You Later',
      preheader: 'Finish your avatar and join in.',
      heading: 'Familiar faces appear over time.',
      body:
        '<p style="margin:0 0 14px 0;">Spend enough time in Decentraland and something interesting happens.</p>' +
        '<p style="margin:0 0 14px 0;">You start recognizing people. Someone remembers you from a place you visited earlier.</p>' +
        "<p style=\"margin:0 0 14px 0;\">That's how communities form.</p>" +
        '<p style="margin:0;">Finish creating your avatar and step in.</p>',
      buttonText: 'Finish Your Avatar',
      buttonUrl: 'https://decentraland.org/auth/login',
      tagline: "You're closer than you think."
    }
  )],

  // ── CP5 — Download Page Viewed ────────────────────────────────────────────
  [5, seqMap(
    {
      subject: 'One Step Left To Enter',
      preheader: 'Download Decentraland to continue.',
      heading: "You're almost there.",
      body:
        '<p style="margin:0 0 14px 0;">You reached the point where Decentraland moves from the browser into the world itself.</p>' +
        '<p style="margin:0 0 14px 0;">To continue, you just need to download the desktop app.</p>' +
        "<p style=\"margin:0 0 14px 0;\">Once it's installed, you'll be able to enter anytime without setting things up again.</p>" +
        '<p style="margin:0;">Download Decentraland and continue.</p>',
      buttonText: 'Download Decentraland',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'The world is waiting.'
    },
    {
      subject: 'Download Once, Enter Anytime',
      preheader: 'Install Decentraland and continue.',
      heading: 'This is the step that opens everything.',
      body:
        '<p style="margin:0 0 14px 0;">Downloading Decentraland lets you move through places in real time.</p>' +
        "<p style=\"margin:0 0 14px 0;\">You'll see other people moving around you, conversations happening, and events taking place.</p>" +
        '<p style="margin:0 0 14px 0;">Once the app is installed, entering becomes as simple as opening it.</p>' +
        '<p style="margin:0;">Download Decentraland and continue.</p>',
      buttonText: 'Download Decentraland',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'The world is waiting.'
    },
    {
      subject: 'People Are Already There',
      preheader: 'Install Decentraland and step inside.',
      heading: 'Something might be happening right now.',
      body:
        "<p style=\"margin:0 0 14px 0;\">Decentraland isn't just something you set up. It's somewhere people show up.</p>" +
        '<p style="margin:0 0 14px 0;">Events happen. Conversations start. Crowds gather.</p>' +
        '<p style="margin:0 0 14px 0;">Downloading the app is the step that lets you join in.</p>' +
        '<p style="margin:0;">Install Decentraland and continue.</p>',
      buttonText: 'Download Decentraland',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'The world is waiting.'
    }
  )],

  // ── CP6 — Download Clicked ────────────────────────────────────────────────
  [6, seqMap(
    {
      subject: 'Almost Installed',
      preheader: 'Just open the file you downloaded.',
      heading: 'You already downloaded Decentraland.',
      body:
        '<p style="margin:0 0 14px 0;">The last step is opening the file that was downloaded.</p>' +
        '<p style="margin:0 0 14px 0;">Look in your browser\'s recent downloads or your Downloads folder and double-click the Decentraland file.</p>' +
        '<p style="margin:0;">The installer will open and finish the rest automatically.</p>',
      buttonText: 'Resume Installation',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'Almost there.'
    },
    {
      subject: 'One Small Step Left',
      preheader: 'Open the installer to finish setting things up.',
      heading: 'Installation takes just a moment.',
      body:
        "<p style=\"margin:0 0 14px 0;\">If Decentraland hasn't opened yet, the installer may still be waiting in your downloads.</p>" +
        '<p style="margin:0 0 14px 0;">Open the file you downloaded earlier and the launcher will take it from there.</p>' +
        "<p style=\"margin:0;\">Once it finishes, Decentraland will open and you'll be ready to continue.</p>",
      buttonText: 'Resume Installation',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'Almost there.'
    },
    {
      subject: "You're Right At The Threshold",
      preheader: 'Open the installer and step inside.',
      heading: "You're almost in.",
      body:
        '<p style="margin:0 0 14px 0;">Decentraland is already on your computer.</p>' +
        "<p style=\"margin:0 0 14px 0;\">All that's left is opening the installer you downloaded earlier.</p>" +
        "<p style=\"margin:0;\">Once it runs, the launcher will open and you'll be ready to join everyone inside.</p>",
      buttonText: 'Resume Installation',
      buttonUrl: 'https://decentraland.org/download',
      tagline: 'Almost there.'
    }
  )]
])

// Fallback for checkpoints without specific content (CP1, CP7)
// prettier-ignore
const FALLBACK_CHECKPOINT_NAMES = new Map<number, string>([
  [1, 'Authentication Started'],
  [2, 'Auth Method Selected'],
  [3, 'Profile Creation'],
  [4, 'Avatar Creator Started'],
  [5, 'Download Page Viewed'],
  [6, 'Download Clicked'],
  [7, 'Launcher Ready']
])

// prettier-ignore
const FALLBACK_CTA_URLS = new Map<number, string>([
  [1, 'https://decentraland.org/auth/login'],
  [2, 'https://decentraland.org/auth/login'],
  [3, 'https://decentraland.org/auth/login'],
  [4, 'https://decentraland.org/auth/login'],
  [5, 'https://decentraland.org/download'],
  [6, 'https://decentraland.org/download'],
  [7, 'decentraland://']
])

export async function createEmailComponent({ config, logs }: Pick<AppComponents, 'config' | 'logs'>): Promise<IEmailComponent> {
  const logger = logs.getLogger('email-component')

  const apiKey = await config.requireString('SENDGRID_API_KEY')
  const fromEmail = await config.requireString('SENDGRID_FROM_EMAIL')
  const templateId = await config.requireString('SENDGRID_TEMPLATE_ID')

  sgMail.setApiKey(apiKey)

  const sendNudge = async (params: SendNudgeParams): Promise<string | undefined> => {
    const { to, checkpointId, sequence } = params

    const content = NUDGE_CONTENT.get(checkpointId)?.get(sequence)
    const cpName = FALLBACK_CHECKPOINT_NAMES.get(checkpointId) ?? `Checkpoint ${checkpointId}`

    const dynamicTemplateData = content
      ? {
          subject: content.subject,
          preheader: content.preheader,
          heading: content.heading,
          body: content.body,
          buttonText: content.buttonText,
          buttonUrl: content.buttonUrl,
          checkpointId,
          tagline: content.tagline
        }
      : {
          // Fallback for unmapped checkpoints
          subject: 'Continue your Decentraland setup',
          preheader: `You were on the ${cpName} step.`,
          heading: "You're almost there.",
          body: '<p style="margin:0;">You were in the middle of setting up your Decentraland account. Pick up where you left off.</p>',
          buttonText: 'Continue',
          buttonUrl: FALLBACK_CTA_URLS.get(checkpointId) ?? 'https://decentraland.org',
          checkpointId,
          tagline: "You're closer than you think."
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
