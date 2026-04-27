import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../../src/ports/db/types'
import { createOnboardingComponent } from '../../src/ports/onboarding/component'
import { IOnboardingComponent } from '../../src/ports/onboarding/types'

function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

function createMockDb(): jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent {
  return {
    query: jest.fn(),
    getPool: jest.fn(),
    withTransaction: jest.fn(),
    start: jest.fn(),
    stop: jest.fn()
  } as unknown as jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent
}

const emptyResult = { rows: [], rowCount: 0, notices: [] }

let onboarding: IOnboardingComponent
let mockDb: ReturnType<typeof createMockDb>

beforeEach(() => {
  mockDb = createMockDb()
  onboarding = createOnboardingComponent({ db: mockDb, logs: createMockLogs() })
})

describe('when recording a checkpoint with action reached', () => {
  describe('and identifierType is anon (CP1)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should upsert the checkpoint with id_type=anon', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 1,
        action: 'reached',
        source: 'landing'
      })

      // 1 INSERT + 1 retroactive close-if-CP2-exists guard
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
      expect(queryText).toContain('ON CONFLICT')
      expect(firstCall[0].values).toContain('anon')
    })

    it('should issue a guard query that closes CP1 if CP2 already exists', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 1,
        action: 'reached'
      })

      const [, secondCall] = mockDb.query.mock.calls
      const queryText = secondCall[0].text ?? secondCall[0]
      expect(queryText).toContain('UPDATE onboarding_checkpoints')
      expect(queryText).toContain('checkpoint = 1')
      expect(queryText).toContain('later.checkpoint = 2')
    })
  })

  describe('and checkpointId is 2 (auth)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should upsert and implicitly close CP1 for the same user_id', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 2,
        action: 'reached',
        source: 'auth'
      })

      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [, secondCall] = mockDb.query.mock.calls
      const queryText = secondCall[0].text ?? secondCall[0]
      expect(queryText).toContain('UPDATE onboarding_checkpoints')
      expect(queryText).toContain('completed_at = NOW()')
      expect(queryText).toContain('checkpoint = 1')
    })
  })

  describe('and checkpointId is 3 (in-world)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should upsert without auto-completing previous checkpoints', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 3,
        action: 'reached',
        wallet: '0xABC',
        source: 'explorer'
      })

      expect(mockDb.query.mock.calls).toHaveLength(1)
      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain('0xabc') // wallet lowercased
    })
  })

  describe('and a wallet is provided', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should lowercase the wallet before insert', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 2,
        action: 'reached',
        wallet: '0xABCDEF'
      })

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain('0xabcdef')
    })
  })
})

describe('when recording a checkpoint with action completed', () => {
  describe('and the row exists', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
    })

    it('should update completed_at on the matching row', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 2,
        action: 'completed',
        email: 'user@test.com',
        wallet: '0xabc'
      })

      expect(mockDb.query.mock.calls).toHaveLength(1)
      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('UPDATE onboarding_checkpoints')
      expect(queryText).toContain('completed_at = NOW()')
    })

    it('should enrich email and wallet with COALESCE', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 2,
        action: 'completed',
        email: 'enriched@test.com'
      })

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain('enriched@test.com')
    })
  })

  describe('and the row does not exist (no prior reached)', () => {
    beforeEach(() => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0, notices: [] }) // UPDATE returns 0 rows
        .mockResolvedValueOnce(emptyResult) // INSERT retroactivo
    })

    it('should insert the row retroactively', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'anon-uuid-1',
        identifierType: 'anon',
        checkpointId: 2,
        action: 'completed',
        email: 'user@test.com'
      })

      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [, secondCall] = mockDb.query.mock.calls
      const queryText = secondCall[0].text ?? secondCall[0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
      expect(queryText).toContain('ON CONFLICT')
    })
  })
})

describe('when getting pending nudges', () => {
  describe('for sequence 1 (24 hours)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({
        rows: [
          { user_id: 'anon-1', email: 'stuck1@test.com' },
          { user_id: 'anon-2', email: 'stuck2@test.com' }
        ],
        rowCount: 2,
        notices: []
      })
    })

    it('should query with 24 hour interval', async () => {
      await onboarding.getPendingNudges(1)

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain(24)
    })

    it('should query CP2 completed without CP3', async () => {
      await onboarding.getPendingNudges(1)

      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('cp2.checkpoint = 2')
      expect(queryText).toContain('cp2.completed_at IS NOT NULL')
      expect(queryText).toContain('cp2.email IS NOT NULL')
      expect(queryText).toContain('NOT EXISTS')
      expect(queryText).toContain('cp3.checkpoint = 3')
    })

    it('should return mapped pending nudge objects (userId + email)', async () => {
      const result = await onboarding.getPendingNudges(1)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ userId: 'anon-1', email: 'stuck1@test.com' })
      expect(result[1]).toEqual({ userId: 'anon-2', email: 'stuck2@test.com' })
    })
  })

  describe('for sequence 2 (72 hours)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should query with 72 hour interval', async () => {
      await onboarding.getPendingNudges(2)

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain(72)
    })

    it('should return empty array when no pending nudges', async () => {
      const result = await onboarding.getPendingNudges(2)
      expect(result).toEqual([])
    })
  })
})

describe('when marking a nudge as sent', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
  })

  it('should insert into email_nudges with checkpoint=2', async () => {
    await onboarding.markNudgeSent('anon-1', 1, 'sg-msg-id-123')

    expect(mockDb.query.mock.calls).toHaveLength(1)
    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).toContain('INSERT INTO email_nudges')
  })

  it('should include the sendgrid message id', async () => {
    await onboarding.markNudgeSent('anon-1', 1, 'sg-msg-id-456')

    const [firstCall] = mockDb.query.mock.calls
    expect(firstCall[0].values).toContain('sg-msg-id-456')
  })

  it('should work without a message id', async () => {
    await expect(onboarding.markNudgeSent('anon-1', 1)).resolves.not.toThrow()

    const [firstCall] = mockDb.query.mock.calls
    expect(firstCall[0].values).toContain(null)
  })

  it('should use ON CONFLICT DO NOTHING to prevent duplicates', async () => {
    await onboarding.markNudgeSent('anon-1', 1, 'sg-msg-id')

    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).toContain('ON CONFLICT')
    expect(queryText).toContain('DO NOTHING')
  })
})
