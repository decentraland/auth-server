import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createEmailComponent } from '../../src/ports/email/component'
import { IEmailComponent } from '../../src/ports/email/types'

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sgMail = require('@sendgrid/mail') as jest.Mocked<{ setApiKey: jest.Mock; send: jest.Mock }>

function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

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

let email: IEmailComponent

beforeEach(async () => {
  sgMail.send.mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'sg-msg-id-123' }, body: '' }, {}])
  email = await createEmailComponent({ config: createMockConfig(), logs: createMockLogs() })
})

describe('when sending a nudge for sequence 1', () => {
  it('should call sgMail.send with the configured template', async () => {
    await email.sendNudge({ to: 'user@test.com', sequence: 1 })

    expect(sgMail.send).toHaveBeenCalledTimes(1)
    const [msg] = sgMail.send.mock.calls[0]
    expect(msg.templateId).toBe('d-template-id')
  })

  it('should include subject, preheader, heading, body, buttonText, buttonUrl and tagline', async () => {
    await email.sendNudge({ to: 'user@test.com', sequence: 1 })

    const [msg] = sgMail.send.mock.calls[0]
    const data = msg.dynamicTemplateData
    expect(data.subject).toBeDefined()
    expect(data.preheader).toBeDefined()
    expect(data.heading).toBeDefined()
    expect(data.body).toBeDefined()
    expect(data.buttonText).toBeDefined()
    expect(data.buttonUrl).toBeDefined()
    expect(data.tagline).toBeDefined()
  })

  it('should point CTA to the download/launcher page', async () => {
    await email.sendNudge({ to: 'user@test.com', sequence: 1 })

    const [msg] = sgMail.send.mock.calls[0]
    expect(msg.dynamicTemplateData.buttonUrl).toBe('https://decentraland.org/download')
  })

  it('should return the SendGrid message id', async () => {
    const messageId = await email.sendNudge({ to: 'user@test.com', sequence: 1 })
    expect(messageId).toBe('sg-msg-id-123')
  })

  it('should send to the correct recipient', async () => {
    await email.sendNudge({ to: 'specific@test.com', sequence: 1 })

    const [msg] = sgMail.send.mock.calls[0]
    expect(msg.to).toBe('specific@test.com')
  })
})

describe('when sending nudges for different sequences', () => {
  it('should use different subjects for sequence 1 vs sequence 2', async () => {
    await email.sendNudge({ to: 'user@test.com', sequence: 1 })
    const [msg1] = sgMail.send.mock.calls[0]

    sgMail.send.mockClear()

    await email.sendNudge({ to: 'user@test.com', sequence: 2 })
    const [msg2] = sgMail.send.mock.calls[0]

    expect(msg1.dynamicTemplateData.subject).not.toBe(msg2.dynamicTemplateData.subject)
  })
})

describe('when SendGrid returns an error', () => {
  beforeEach(() => {
    sgMail.send.mockRejectedValue(new Error('SendGrid API error'))
  })

  it('should not throw', async () => {
    await expect(email.sendNudge({ to: 'user@test.com', sequence: 1 })).resolves.not.toThrow()
  })

  it('should return undefined', async () => {
    const result = await email.sendNudge({ to: 'user@test.com', sequence: 1 })
    expect(result).toBeUndefined()
  })
})
