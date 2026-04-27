import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { ISlackComponent } from '@dcl/slack-component'
import { IFeatureFlagsAdapter } from '../../src/adapters/feature-flags'
import { IEmailComponent } from '../../src/ports/email/types'
import { createNudgeJobComponent } from '../../src/ports/nudge-job/component'
import { INudgeJobComponent } from '../../src/ports/nudge-job/types'
import { IOnboardingComponent, PendingNudge } from '../../src/ports/onboarding/types'

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

let nudgeJob: INudgeJobComponent
let mockOnboarding: ReturnType<typeof createMockOnboarding>
let mockEmail: ReturnType<typeof createMockEmail>
let mockSlack: ReturnType<typeof createMockSlack>
let mockFeatureFlags: IFeatureFlagsAdapter

beforeEach(() => {
  mockOnboarding = createMockOnboarding()
  mockEmail = createMockEmail()
  mockSlack = createMockSlack()
  mockFeatureFlags = createMockFeatureFlags()

  mockOnboarding.markNudgeSent.mockResolvedValue(undefined)
  mockEmail.sendNudge.mockResolvedValue('sg-msg-id-123')

  nudgeJob = createNudgeJobComponent({
    onboarding: mockOnboarding as unknown as IOnboardingComponent,
    email: mockEmail as unknown as IEmailComponent,
    slack: mockSlack as unknown as ISlackComponent,
    logs: createMockLogs(),
    config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
    featureFlags: mockFeatureFlags
  })
})

describe('when running the nudge evaluator with pending nudges for sequence 1', () => {
  let pendingNudge: PendingNudge

  beforeEach(() => {
    pendingNudge = { userId: 'anon-uuid-1', email: 'stuck@test.com' }

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([pendingNudge]) // sequence 1
      .mockResolvedValue([]) // sequence 2
  })

  it('should send the nudge email', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledWith({
      to: 'stuck@test.com',
      sequence: 1
    })
  })

  it('should mark the nudge as sent with the returned message id', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('anon-uuid-1', 1, 'sg-msg-id-123')
  })
})

describe('when running the nudge evaluator with pending nudges for both sequences', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'anon-1', email: 'user1@test.com' }]) // seq 1
      .mockResolvedValueOnce([{ userId: 'anon-2', email: 'user2@test.com' }]) // seq 2
  })

  it('should process both sequences', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledTimes(2)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(1)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(2)
    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(2)
  })
})

describe('when email sending returns undefined (failure)', () => {
  beforeEach(() => {
    mockEmail.sendNudge.mockResolvedValue(undefined)
    mockOnboarding.getPendingNudges.mockResolvedValueOnce([{ userId: 'anon-1', email: 'user@test.com' }]).mockResolvedValue([])
  })

  it('should still call markNudgeSent with undefined messageId', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('anon-1', 1, undefined)
  })
})

describe('when email sending throws', () => {
  let secondNudge: PendingNudge

  beforeEach(() => {
    secondNudge = { userId: 'anon-2', email: 'user2@test.com' }

    mockEmail.sendNudge.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce('sg-msg-id-ok')

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'anon-1', email: 'user1@test.com' }, secondNudge])
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
})

describe('when getPendingNudges throws for one sequence', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges
      .mockRejectedValueOnce(new Error('DB connection error')) // seq 1 fails
      .mockResolvedValueOnce([{ userId: 'anon-1', email: 'user@test.com' }]) // seq 2 ok
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

      nudgeJob = createNudgeJobComponent({
        onboarding: mockOnboarding as unknown as IOnboardingComponent,
        email: mockEmail as unknown as IEmailComponent,
        slack: mockSlack as unknown as ISlackComponent,
        logs: createMockLogs(),
        config: createMockConfig(),
        featureFlags: mockFeatureFlags
      })
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

describe('when nudge emails feature flag is disabled', () => {
  beforeEach(() => {
    mockFeatureFlags = createMockFeatureFlags(false)
    mockOnboarding.getPendingNudges.mockResolvedValue([{ userId: 'anon-1', email: 'user@test.com' }])

    nudgeJob = createNudgeJobComponent({
      onboarding: mockOnboarding as unknown as IOnboardingComponent,
      email: mockEmail as unknown as IEmailComponent,
      slack: mockSlack as unknown as ISlackComponent,
      logs: createMockLogs(),
      config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
      featureFlags: mockFeatureFlags
    })
  })

  it('should skip the evaluator entirely', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).not.toHaveBeenCalled()
    expect(mockEmail.sendNudge).not.toHaveBeenCalled()
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

    nudgeJob = createNudgeJobComponent({
      onboarding: mockOnboarding as unknown as IOnboardingComponent,
      email: mockEmail as unknown as IEmailComponent,
      slack: mockSlack as unknown as ISlackComponent,
      logs: createMockLogs(),
      config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
      featureFlags: mockFeatureFlags
    })
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
