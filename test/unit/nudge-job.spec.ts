import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { IAnalyticsComponent } from '@dcl/analytics-component'
import { ISlackComponent } from '@dcl/slack-component'
import { IFeatureFlagsAdapter } from '../../src/adapters/feature-flags'
import { IPgComponent } from '../../src/ports/db/types'
import { IEmailComponent } from '../../src/ports/email/types'
import { createNudgeJobComponent } from '../../src/ports/nudge-job/component'
import { INudgeJobComponent } from '../../src/ports/nudge-job/types'
import { IOnboardingComponent, PendingNudge } from '../../src/ports/onboarding/types'
import { AnalyticsEvent, AnalyticsEventPayload } from '../../src/types/analytics'

type AppComponentsDb = IPgComponent

const TEMPLATE_ID = 'd-template-id'

function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

function createMockOnboarding(): jest.Mocked<Pick<IOnboardingComponent, 'getPendingNudges' | 'markNudgeSent'>> {
  return {
    getPendingNudges: jest.fn(),
    markNudgeSent: jest.fn()
  }
}

function createMockEmail(): jest.Mocked<Pick<IEmailComponent, 'sendNudge'>> {
  return {
    sendNudge: jest.fn()
  }
}

function createMockSlack(): jest.Mocked<Pick<ISlackComponent, 'sendMessage'>> {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined)
  }
}

function createMockAnalytics() {
  return {
    fireEvent: jest.fn(),
    sendEvents: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  }
}

function createMockConfig(overrides: Record<string, string> = {}): IConfigComponent {
  return {
    getString: jest.fn().mockImplementation(async (key: string) => overrides[key] ?? undefined),
    getNumber: jest.fn().mockResolvedValue(undefined),
    requireString: jest.fn().mockImplementation(async (key: string) => {
      if (overrides[key]) return overrides[key]
      throw new Error(`Missing config: ${key}`)
    }),
    requireNumber: jest.fn().mockRejectedValue(new Error('not implemented'))
  }
}

function createMockFeatureFlags(enabled = true, whitelist?: string[]): IFeatureFlagsAdapter {
  return {
    isNudgeEmailEnabled: jest.fn().mockReturnValue(enabled),
    getNudgeEmailWhitelist: jest.fn().mockReturnValue(whitelist)
  } as unknown as IFeatureFlagsAdapter
}

function createMockDb(lockAcquired = true) {
  return {
    query: jest.fn().mockImplementation(async (q: unknown) => {
      const text = typeof q === 'object' && q !== null && 'text' in q ? String((q as { text: string }).text) : String(q)
      if (text.includes('pg_try_advisory_lock')) {
        return { rows: [{ acquired: lockAcquired }], rowCount: 1, notices: [] }
      }
      if (text.includes('pg_advisory_unlock')) {
        return { rows: [{ pg_advisory_unlock: true }], rowCount: 1, notices: [] }
      }
      return { rows: [], rowCount: 0, notices: [] }
    })
  }
}

let nudgeJob: INudgeJobComponent
let mockOnboarding: ReturnType<typeof createMockOnboarding>
let mockEmail: ReturnType<typeof createMockEmail>
let mockSlack: ReturnType<typeof createMockSlack>
let mockAnalytics: ReturnType<typeof createMockAnalytics>
let mockFeatureFlags: IFeatureFlagsAdapter
let mockDb: ReturnType<typeof createMockDb>

function buildJob(configOverrides: Record<string, string> = { SLACK_NUDGE_CHANNEL: 'test-channel' }) {
  return createNudgeJobComponent({
    onboarding: mockOnboarding as unknown as IOnboardingComponent,
    email: mockEmail as unknown as IEmailComponent,
    slack: mockSlack as unknown as ISlackComponent,
    logs: createMockLogs(),
    config: createMockConfig(configOverrides),
    featureFlags: mockFeatureFlags,
    analytics: mockAnalytics as unknown as IAnalyticsComponent<AnalyticsEventPayload>,
    db: mockDb as unknown as AppComponentsDb
  })
}

beforeEach(() => {
  mockOnboarding = createMockOnboarding()
  mockEmail = createMockEmail()
  mockSlack = createMockSlack()
  mockAnalytics = createMockAnalytics()
  mockFeatureFlags = createMockFeatureFlags()
  mockDb = createMockDb()

  mockOnboarding.markNudgeSent.mockResolvedValue(undefined)
  mockEmail.sendNudge.mockResolvedValue({ templateId: TEMPLATE_ID, messageId: 'sg-msg-id-123' })

  nudgeJob = buildJob()
})

describe('when running the nudge evaluator with pending nudges for sequence 1', () => {
  let pendingNudge: PendingNudge

  beforeEach(() => {
    pendingNudge = { userId: 'anon-uuid-1', email: 'stuck@test.com' }

    mockOnboarding.getPendingNudges.mockResolvedValueOnce([pendingNudge]).mockResolvedValue([])
  })

  it('should send the nudge email', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledWith({ to: 'stuck@test.com', sequence: 1 })
  })

  it('should mark the nudge as sent with the returned message id', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('anon-uuid-1', 1, 'sg-msg-id-123')
  })

  it('should fire the NUDGE_EMAIL_SENT analytics event', async () => {
    await nudgeJob.runEvaluator()

    expect(mockAnalytics.fireEvent).toHaveBeenCalledWith(
      AnalyticsEvent.NUDGE_EMAIL_SENT,
      expect.objectContaining({
        user_id: 'anon-uuid-1',
        email: 'stuck@test.com',
        checkpoint: 2,
        sequence: 1,
        template_id: TEMPLATE_ID,
        sendgrid_message_id: 'sg-msg-id-123',
        sent_at: expect.any(String)
      })
    )
  })
})

describe('when running the nudge evaluator with pending nudges for both sequences', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'anon-1', email: 'user1@test.com' }])
      .mockResolvedValueOnce([{ userId: 'anon-2', email: 'user2@test.com' }])
  })

  it('should process both sequences', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledTimes(2)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(1)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(2)
    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(2)
    expect(mockAnalytics.fireEvent).toHaveBeenCalledTimes(2)
  })
})

describe('when sendNudge returns an error result (no messageId)', () => {
  beforeEach(() => {
    mockEmail.sendNudge.mockResolvedValue({ templateId: TEMPLATE_ID, error: 'SendGrid API error' })
    mockOnboarding.getPendingNudges.mockResolvedValueOnce([{ userId: 'anon-1', email: 'user@test.com' }]).mockResolvedValue([])
  })

  it('should NOT call markNudgeSent', async () => {
    await nudgeJob.runEvaluator()
    expect(mockOnboarding.markNudgeSent).not.toHaveBeenCalled()
  })

  it('should fire the NUDGE_EMAIL_FAILED analytics event with the error', async () => {
    await nudgeJob.runEvaluator()

    expect(mockAnalytics.fireEvent).toHaveBeenCalledWith(
      AnalyticsEvent.NUDGE_EMAIL_FAILED,
      expect.objectContaining({
        user_id: 'anon-1',
        email: 'user@test.com',
        checkpoint: 2,
        sequence: 1,
        template_id: TEMPLATE_ID,
        error: 'SendGrid API error',
        failed_at: expect.any(String)
      })
    )
  })
})

describe('when sendNudge throws', () => {
  beforeEach(() => {
    mockEmail.sendNudge
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ templateId: TEMPLATE_ID, messageId: 'sg-msg-id-ok' })

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([
        { userId: 'anon-1', email: 'user1@test.com' },
        { userId: 'anon-2', email: 'user2@test.com' }
      ])
      .mockResolvedValue([])
  })

  it('should continue processing remaining nudges', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(2)
    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('anon-2', 1, 'sg-msg-id-ok')
  })

  it('should not throw', async () => {
    await expect(nudgeJob.runEvaluator()).resolves.not.toThrow()
  })
})

describe('when there are no pending nudges', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges.mockResolvedValue([])
  })

  it('should not call sendNudge', async () => {
    await nudgeJob.runEvaluator()
    expect(mockEmail.sendNudge).not.toHaveBeenCalled()
  })

  it('should not call markNudgeSent', async () => {
    await nudgeJob.runEvaluator()
    expect(mockOnboarding.markNudgeSent).not.toHaveBeenCalled()
  })

  it('should not fire any analytics event', async () => {
    await nudgeJob.runEvaluator()
    expect(mockAnalytics.fireEvent).not.toHaveBeenCalled()
  })
})

describe('when getPendingNudges throws for one sequence', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges
      .mockRejectedValueOnce(new Error('DB connection error'))
      .mockResolvedValueOnce([{ userId: 'anon-1', email: 'user@test.com' }])
  })

  it('should continue to process the other sequence', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(1)
    expect(mockEmail.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }))
  })

  it('should not throw', async () => {
    await expect(nudgeJob.runEvaluator()).resolves.not.toThrow()
  })
})

describe('slack notifications', () => {
  describe('when SLACK_NUDGE_CHANNEL is configured', () => {
    beforeEach(() => {
      mockOnboarding.getPendingNudges.mockResolvedValueOnce([{ userId: 'anon-1', email: 'stuck@test.com' }]).mockResolvedValue([])
    })

    it('should send a Slack message after nudge is sent', async () => {
      await nudgeJob.runEvaluator()

      // Allow fire-and-forget promise to resolve
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockSlack.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('stuck@test.com')
      })
      expect(mockSlack.sendMessage).toHaveBeenCalledWith({
        channel: 'test-channel',
        text: expect.stringContaining('seq 1')
      })
    })
  })

  describe('when SLACK_NUDGE_CHANNEL is not configured', () => {
    beforeEach(() => {
      mockOnboarding.getPendingNudges.mockResolvedValueOnce([{ userId: 'anon-1', email: 'stuck@test.com' }]).mockResolvedValue([])
      nudgeJob = buildJob({})
    })

    it('should not send a Slack message', async () => {
      await nudgeJob.runEvaluator()

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockSlack.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('when Slack sendMessage throws', () => {
    beforeEach(() => {
      mockSlack.sendMessage.mockRejectedValue(new Error('Slack API error'))
      mockOnboarding.getPendingNudges.mockResolvedValueOnce([{ userId: 'anon-1', email: 'stuck@test.com' }]).mockResolvedValue([])
    })

    it('should not affect nudge processing', async () => {
      await nudgeJob.runEvaluator()

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockEmail.sendNudge).toHaveBeenCalledTimes(1)
      expect(mockOnboarding.markNudgeSent).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when another nudge-job run holds the advisory lock', () => {
  beforeEach(() => {
    mockDb = createMockDb(false) // pg_try_advisory_lock returns false
    mockOnboarding.getPendingNudges.mockResolvedValue([{ userId: 'anon-1', email: 'user@test.com' }])
    nudgeJob = buildJob()
  })

  it('should skip the run without querying or sending emails', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).not.toHaveBeenCalled()
    expect(mockEmail.sendNudge).not.toHaveBeenCalled()
    expect(mockAnalytics.fireEvent).not.toHaveBeenCalled()
  })
})

describe('when nudge emails feature flag is disabled', () => {
  beforeEach(() => {
    mockFeatureFlags = createMockFeatureFlags(false)
    mockOnboarding.getPendingNudges.mockResolvedValue([{ userId: 'anon-1', email: 'user@test.com' }])
    nudgeJob = buildJob()
  })

  it('should skip the evaluator entirely', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).not.toHaveBeenCalled()
    expect(mockEmail.sendNudge).not.toHaveBeenCalled()
    expect(mockAnalytics.fireEvent).not.toHaveBeenCalled()
  })
})

describe('when nudge emails feature flag has a whitelist', () => {
  beforeEach(() => {
    mockFeatureFlags = createMockFeatureFlags(true, ['allowed@test.com', 'vip@test.com'])

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([
        { userId: 'anon-1', email: 'allowed@test.com' },
        { userId: 'anon-2', email: 'random@test.com' },
        { userId: 'anon-3', email: 'VIP@test.com' }
      ])
      .mockResolvedValue([])
    nudgeJob = buildJob()
  })

  it('should only send nudges to whitelisted emails', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(2)
    expect(mockEmail.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ to: 'allowed@test.com' }))
    expect(mockEmail.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ to: 'VIP@test.com' }))
  })

  it('should not send nudges to non-whitelisted emails', async () => {
    await nudgeJob.runEvaluator()

    const sentEmails = mockEmail.sendNudge.mock.calls.map((call: unknown[]) => (call[0] as { to: string }).to)
    expect(sentEmails).not.toContain('random@test.com')
  })
})
