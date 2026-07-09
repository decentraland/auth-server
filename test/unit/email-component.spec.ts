import { IConfigComponent } from '@well-known-components/interfaces'
import { createEmailComponent } from '../../src/ports/email/component'
import { IEmailComponent } from '../../src/ports/email/types'
import { createMockLogs } from '../mocks'

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sgMail = require('@sendgrid/mail') as jest.Mocked<{ setApiKey: jest.Mock; send: jest.Mock }>

type SentEmail = { to: string; templateId: string; dynamicTemplateData: Record<string, unknown> }

function createMockConfig(overrides: Record<string, string> = {}): IConfigComponent {
  const defaults: Record<string, string> = {
    SENDGRID_API_KEY: 'test-api-key',
    SENDGRID_FROM_EMAIL: 'hello@decentraland.org',
    SENDGRID_TEMPLATE_ID: 'd-template-id'
  }
  const values = { ...defaults, ...overrides }

  return {
    requireString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key])),
    getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key] || undefined)),
    requireNumber: jest.fn(),
    getNumber: jest.fn()
  } as unknown as IConfigComponent
}

describe('when sending a nudge email', () => {
  let email: IEmailComponent

  beforeEach(async () => {
    sgMail.send.mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'sg-msg-id-123' }, body: '' }, {}])
    email = await createEmailComponent({ config: createMockConfig(), logs: createMockLogs() })
  })

  describe('and the checkpoint is 3 and the sequence is 1', () => {
    let sentMessage: SentEmail
    let messageId: string | undefined

    beforeEach(async () => {
      messageId = await email.sendNudge({ to: 'user@test.com', checkpointId: 3, sequence: 1 })
      sentMessage = sgMail.send.mock.calls[0][0]
    })

    it('should send exactly one email', () => {
      expect(sgMail.send).toHaveBeenCalledTimes(1)
    })

    it('should send it to the requested recipient', () => {
      expect(sentMessage.to).toBe('user@test.com')
    })

    it('should use the configured SendGrid template', () => {
      expect(sentMessage.templateId).toBe('d-template-id')
    })

    it('should include the checkpoint 3 content in the template data', () => {
      expect(sentMessage.dynamicTemplateData).toMatchObject({
        checkpointId: 3,
        subject: 'Finish Choosing Your Name',
        heading: expect.stringContaining('choosing your name')
      })
    })

    it('should point the button at the auth login', () => {
      expect(sentMessage.dynamicTemplateData.buttonUrl).toBe('https://decentraland.org/auth/login')
    })

    it('should populate every template field the email needs', () => {
      const data = sentMessage.dynamicTemplateData
      expect(data.subject).toBeDefined()
      expect(data.preheader).toBeDefined()
      expect(data.heading).toBeDefined()
      expect(data.body).toBeDefined()
      expect(data.buttonText).toBeDefined()
      expect(data.tagline).toBeDefined()
    })

    it('should return the SendGrid message id', () => {
      expect(messageId).toBe('sg-msg-id-123')
    })
  })

  describe('and the same checkpoint is sent for two different sequences', () => {
    let subjectForSequence1: unknown
    let subjectForSequence3: unknown

    beforeEach(async () => {
      await email.sendNudge({ to: 'user@test.com', checkpointId: 3, sequence: 1 })
      await email.sendNudge({ to: 'user@test.com', checkpointId: 3, sequence: 3 })
      subjectForSequence1 = (sgMail.send.mock.calls[0][0] as SentEmail).dynamicTemplateData.subject
      subjectForSequence3 = (sgMail.send.mock.calls[1][0] as SentEmail).dynamicTemplateData.subject
    })

    it('should use a different subject for each sequence', () => {
      expect(subjectForSequence1).not.toBe(subjectForSequence3)
    })
  })

  describe('and the checkpoint is 5 and the sequence is 2 (download page)', () => {
    let sentMessage: SentEmail

    beforeEach(async () => {
      await email.sendNudge({ to: 'user@test.com', checkpointId: 5, sequence: 2 })
      sentMessage = sgMail.send.mock.calls[0][0]
    })

    it('should point the button at the download page', () => {
      expect(sentMessage.dynamicTemplateData.buttonUrl).toBe('https://decentraland.org/download')
    })

    it('should use the download button text', () => {
      expect(sentMessage.dynamicTemplateData.buttonText).toBe('Download Decentraland')
    })
  })

  describe('and the checkpoint is unmapped (CP7 fallback)', () => {
    let sentMessage: SentEmail

    beforeEach(async () => {
      await email.sendNudge({ to: 'user@test.com', checkpointId: 7, sequence: 3 })
      sentMessage = sgMail.send.mock.calls[0][0]
    })

    it('should still use the configured SendGrid template', () => {
      expect(sentMessage.templateId).toBe('d-template-id')
    })

    it('should use the generic fallback subject', () => {
      expect(sentMessage.dynamicTemplateData.subject).toBe('Continue your Decentraland setup')
    })

    it('should point the button at the app deep link', () => {
      expect(sentMessage.dynamicTemplateData.buttonUrl).toBe('decentraland://')
    })
  })

  describe('and SendGrid rejects the send', () => {
    beforeEach(() => {
      sgMail.send.mockRejectedValue(new Error('SendGrid API error'))
    })

    it('should not throw', async () => {
      await expect(email.sendNudge({ to: 'user@test.com', checkpointId: 3, sequence: 1 })).resolves.not.toThrow()
    })

    it('should resolve with undefined', async () => {
      expect(await email.sendNudge({ to: 'user@test.com', checkpointId: 3, sequence: 1 })).toBeUndefined()
    })
  })
})
