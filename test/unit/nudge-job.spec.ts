import { ILoggerComponent } from '@well-known-components/interfaces'
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

let nudgeJob: INudgeJobComponent
let mockOnboarding: ReturnType<typeof createMockOnboarding>
let mockEmail: ReturnType<typeof createMockEmail>

beforeEach(() => {
  mockOnboarding = createMockOnboarding()
  mockEmail = createMockEmail()

  mockOnboarding.markNudgeSent.mockResolvedValue(undefined)
  mockEmail.sendNudge.mockResolvedValue('sg-msg-id-123')

  nudgeJob = createNudgeJobComponent({
    onboarding: mockOnboarding as unknown as IOnboardingComponent,
    email: mockEmail as unknown as IEmailComponent,
    logs: createMockLogs()
  })
})

describe('when running the nudge evaluator with pending nudges for sequence 1', () => {
  let pendingNudge: PendingNudge

  beforeEach(() => {
    pendingNudge = { userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' }

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([pendingNudge]) // sequence 1
      .mockResolvedValue([]) // sequences 2 and 3
  })

  it('should send the nudge email', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledWith({
      to: 'stuck@test.com',
      checkpointId: 3,
      sequence: 1
    })
  })

  it('should mark the nudge as sent with the returned message id', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('stuck@test.com', 3, 1, 'sg-msg-id-123')
  })
})

describe('when running the nudge evaluator with pending nudges for multiple sequences', () => {
  beforeEach(() => {
    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'user1@test.com', checkpointId: 2, email: 'user1@test.com' }]) // seq 1
      .mockResolvedValueOnce([{ userId: 'user2@test.com', checkpointId: 3, email: 'user2@test.com' }]) // seq 2
      .mockResolvedValueOnce([{ userId: 'user3@test.com', checkpointId: 1, email: 'user3@test.com' }]) // seq 3
  })

  it('should process all three sequences', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledTimes(3)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(1)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(2)
    expect(mockOnboarding.getPendingNudges).toHaveBeenCalledWith(3)
    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(3)
  })
})

describe('when email sending returns undefined (failure)', () => {
  beforeEach(() => {
    mockEmail.sendNudge.mockResolvedValue(undefined)
    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'user@test.com', checkpointId: 3, email: 'user@test.com' }])
      .mockResolvedValue([])
  })

  it('should still call markNudgeSent with undefined messageId', async () => {
    await nudgeJob.runEvaluator()

    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('user@test.com', 3, 1, undefined)
  })
})

describe('when email sending throws', () => {
  let secondNudge: PendingNudge

  beforeEach(() => {
    secondNudge = { userId: 'user2@test.com', checkpointId: 2, email: 'user2@test.com' }

    mockEmail.sendNudge.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce('sg-msg-id-ok')

    mockOnboarding.getPendingNudges
      .mockResolvedValueOnce([{ userId: 'user1@test.com', checkpointId: 3, email: 'user1@test.com' }, secondNudge])
      .mockResolvedValue([])
  })

  it('should continue processing remaining nudges', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(2)
    expect(mockOnboarding.markNudgeSent).toHaveBeenCalledWith('user2@test.com', 2, 1, 'sg-msg-id-ok')
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
      .mockResolvedValueOnce([{ userId: 'user@test.com', checkpointId: 3, email: 'user@test.com' }]) // seq 2 ok
      .mockResolvedValueOnce([]) // seq 3 ok
  })

  it('should continue to process other sequences', async () => {
    await nudgeJob.runEvaluator()

    expect(mockEmail.sendNudge).toHaveBeenCalledTimes(1)
    expect(mockEmail.sendNudge).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }))
  })

  it('should not throw', async () => {
    await expect(nudgeJob.runEvaluator()).resolves.not.toThrow()
  })
})
