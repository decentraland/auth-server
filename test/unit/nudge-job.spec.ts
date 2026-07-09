import { IConfigComponent } from '@well-known-components/interfaces'
import { ISlackComponent } from '@dcl/slack-component'
import { IFeatureFlagsAdapter } from '../../src/adapters/feature-flags'
import { IEmailComponent } from '../../src/ports/email/types'
import { createNudgeJobComponent } from '../../src/ports/nudge-job/component'
import { INudgeJobComponent } from '../../src/ports/nudge-job/types'
import { IOnboardingComponent, PendingNudge } from '../../src/ports/onboarding/types'
import { createMockLogs } from '../mocks'

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
  } as unknown as IConfigComponent
}

function createMockFeatureFlags(enabled = true, whitelist?: string[]): IFeatureFlagsAdapter {
  return {
    isNudgeEmailEnabled: jest.fn().mockReturnValue(enabled),
    getNudgeEmailWhitelist: jest.fn().mockReturnValue(whitelist)
  } as unknown as IFeatureFlagsAdapter
}

// Lets the fire-and-forget Slack notification (`void notifySlack(...)`) settle after runEvaluator resolves.
const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 10))

describe('when running the nudge evaluator', () => {
  let onboarding: ReturnType<typeof createMockOnboarding>
  let email: ReturnType<typeof createMockEmail>
  let slack: ReturnType<typeof createMockSlack>

  beforeEach(() => {
    onboarding = createMockOnboarding()
    email = createMockEmail()
    slack = createMockSlack()
    onboarding.markNudgeSent.mockResolvedValue(undefined)
    email.sendNudge.mockResolvedValue('sg-msg-id-123')
  })

  describe('and nudge emails are enabled with the Slack channel configured', () => {
    let nudgeJob: INudgeJobComponent

    beforeEach(() => {
      nudgeJob = createNudgeJobComponent({
        onboarding: onboarding as unknown as IOnboardingComponent,
        email: email as unknown as IEmailComponent,
        slack: slack as unknown as ISlackComponent,
        logs: createMockLogs(),
        config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
        featureFlags: createMockFeatureFlags(true)
      })
    })

    describe('and there are pending nudges for sequence 1', () => {
      let pendingNudge: PendingNudge

      beforeEach(() => {
        pendingNudge = { userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' }
        onboarding.getPendingNudges.mockResolvedValueOnce([pendingNudge]).mockResolvedValue([])
      })

      it('should send the nudge email for that sequence', async () => {
        await nudgeJob.runEvaluator()

        expect(email.sendNudge).toHaveBeenCalledWith({ to: 'stuck@test.com', checkpointId: 3, sequence: 1 })
      })

      it('should mark the nudge as sent with the returned message id', async () => {
        await nudgeJob.runEvaluator()

        expect(onboarding.markNudgeSent).toHaveBeenCalledWith('stuck@test.com', 3, 1, 'sg-msg-id-123')
      })

      it('should notify the configured Slack channel about the nudge', async () => {
        await nudgeJob.runEvaluator()
        await flushMicrotasks()

        expect(slack.sendMessage).toHaveBeenCalledWith({ channel: 'test-channel', text: expect.stringContaining('CP3') })
      })

      it('should include the sequence in the Slack notification', async () => {
        await nudgeJob.runEvaluator()
        await flushMicrotasks()

        expect(slack.sendMessage).toHaveBeenCalledWith({ channel: 'test-channel', text: expect.stringContaining('seq 1') })
      })
    })

    describe('and there are pending nudges for multiple sequences', () => {
      beforeEach(() => {
        onboarding.getPendingNudges
          .mockResolvedValueOnce([{ userId: 'user1@test.com', checkpointId: 2, email: 'user1@test.com' }])
          .mockResolvedValueOnce([{ userId: 'user2@test.com', checkpointId: 3, email: 'user2@test.com' }])
          .mockResolvedValueOnce([{ userId: 'user3@test.com', checkpointId: 1, email: 'user3@test.com' }])
      })

      it('should query pending nudges for each of the three sequences', async () => {
        await nudgeJob.runEvaluator()

        expect(onboarding.getPendingNudges).toHaveBeenCalledWith(1)
        expect(onboarding.getPendingNudges).toHaveBeenCalledWith(2)
        expect(onboarding.getPendingNudges).toHaveBeenCalledWith(3)
      })

      it('should send an email for every pending nudge', async () => {
        await nudgeJob.runEvaluator()

        expect(email.sendNudge).toHaveBeenCalledTimes(3)
      })
    })

    describe('and email sending resolves undefined for a nudge', () => {
      beforeEach(() => {
        email.sendNudge.mockResolvedValue(undefined)
        onboarding.getPendingNudges
          .mockResolvedValueOnce([{ userId: 'user@test.com', checkpointId: 3, email: 'user@test.com' }])
          .mockResolvedValue([])
      })

      it('should still mark the nudge as sent with an undefined message id', async () => {
        await nudgeJob.runEvaluator()

        expect(onboarding.markNudgeSent).toHaveBeenCalledWith('user@test.com', 3, 1, undefined)
      })
    })

    describe('and email sending throws for one nudge', () => {
      let secondNudge: PendingNudge

      beforeEach(() => {
        secondNudge = { userId: 'user2@test.com', checkpointId: 2, email: 'user2@test.com' }
        email.sendNudge.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce('sg-msg-id-ok')
        onboarding.getPendingNudges
          .mockResolvedValueOnce([{ userId: 'user1@test.com', checkpointId: 3, email: 'user1@test.com' }, secondNudge])
          .mockResolvedValue([])
      })

      it('should keep processing the remaining nudges', async () => {
        await nudgeJob.runEvaluator()

        expect(onboarding.markNudgeSent).toHaveBeenCalledWith('user2@test.com', 2, 1, 'sg-msg-id-ok')
      })

      it('should not throw', async () => {
        await expect(nudgeJob.runEvaluator()).resolves.not.toThrow()
      })
    })

    describe('and there are no pending nudges', () => {
      beforeEach(() => {
        onboarding.getPendingNudges.mockResolvedValue([])
      })

      it('should not send any nudge email', async () => {
        await nudgeJob.runEvaluator()

        expect(email.sendNudge).not.toHaveBeenCalled()
      })

      it('should not mark any nudge as sent', async () => {
        await nudgeJob.runEvaluator()

        expect(onboarding.markNudgeSent).not.toHaveBeenCalled()
      })
    })

    describe('and fetching pending nudges throws for one sequence', () => {
      beforeEach(() => {
        onboarding.getPendingNudges
          .mockRejectedValueOnce(new Error('DB connection error'))
          .mockResolvedValueOnce([{ userId: 'user@test.com', checkpointId: 3, email: 'user@test.com' }])
          .mockResolvedValueOnce([])
      })

      it('should keep processing the other sequences', async () => {
        await nudgeJob.runEvaluator()

        expect(email.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }))
      })

      it('should not throw', async () => {
        await expect(nudgeJob.runEvaluator()).resolves.not.toThrow()
      })
    })

    describe('and Slack sendMessage throws', () => {
      beforeEach(() => {
        slack.sendMessage.mockRejectedValue(new Error('Slack API error'))
        onboarding.getPendingNudges
          .mockResolvedValueOnce([{ userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' }])
          .mockResolvedValue([])
      })

      it('should still send the nudge email', async () => {
        await nudgeJob.runEvaluator()
        await flushMicrotasks()

        expect(email.sendNudge).toHaveBeenCalledTimes(1)
      })

      it('should still mark the nudge as sent', async () => {
        await nudgeJob.runEvaluator()
        await flushMicrotasks()

        expect(onboarding.markNudgeSent).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and nudge emails are enabled but the Slack channel is not configured', () => {
    let nudgeJob: INudgeJobComponent

    beforeEach(() => {
      nudgeJob = createNudgeJobComponent({
        onboarding: onboarding as unknown as IOnboardingComponent,
        email: email as unknown as IEmailComponent,
        slack: slack as unknown as ISlackComponent,
        logs: createMockLogs(),
        config: createMockConfig(),
        featureFlags: createMockFeatureFlags(true)
      })
      onboarding.getPendingNudges
        .mockResolvedValueOnce([{ userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' }])
        .mockResolvedValue([])
    })

    it('should not send a Slack message', async () => {
      await nudgeJob.runEvaluator()
      await flushMicrotasks()

      expect(slack.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('and nudge emails are disabled', () => {
    let nudgeJob: INudgeJobComponent

    beforeEach(() => {
      nudgeJob = createNudgeJobComponent({
        onboarding: onboarding as unknown as IOnboardingComponent,
        email: email as unknown as IEmailComponent,
        slack: slack as unknown as ISlackComponent,
        logs: createMockLogs(),
        config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
        featureFlags: createMockFeatureFlags(false)
      })
      onboarding.getPendingNudges.mockResolvedValue([{ userId: 'user@test.com', checkpointId: 3, email: 'user@test.com' }])
    })

    it('should not query for pending nudges', async () => {
      await nudgeJob.runEvaluator()

      expect(onboarding.getPendingNudges).not.toHaveBeenCalled()
    })

    it('should not send any nudge email', async () => {
      await nudgeJob.runEvaluator()

      expect(email.sendNudge).not.toHaveBeenCalled()
    })
  })

  describe('and nudge emails are enabled with a whitelist', () => {
    let nudgeJob: INudgeJobComponent

    beforeEach(() => {
      nudgeJob = createNudgeJobComponent({
        onboarding: onboarding as unknown as IOnboardingComponent,
        email: email as unknown as IEmailComponent,
        slack: slack as unknown as ISlackComponent,
        logs: createMockLogs(),
        config: createMockConfig({ SLACK_NUDGE_CHANNEL: 'test-channel' }),
        featureFlags: createMockFeatureFlags(true, ['allowed@test.com', 'vip@test.com'])
      })
      onboarding.getPendingNudges
        .mockResolvedValueOnce([
          { userId: 'allowed@test.com', checkpointId: 2, email: 'allowed@test.com' },
          { userId: 'random@test.com', checkpointId: 3, email: 'random@test.com' },
          { userId: 'vip@test.com', checkpointId: 1, email: 'VIP@test.com' }
        ])
        .mockResolvedValue([])
    })

    it('should send nudges to the whitelisted emails', async () => {
      await nudgeJob.runEvaluator()

      expect(email.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ to: 'allowed@test.com' }))
      expect(email.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ to: 'VIP@test.com' }))
    })

    it('should not send nudges to non-whitelisted emails', async () => {
      await nudgeJob.runEvaluator()

      const sentRecipients = email.sendNudge.mock.calls.map(call => call[0].to)
      expect(sentRecipients).not.toContain('random@test.com')
    })
  })
})
