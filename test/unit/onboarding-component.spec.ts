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
  describe('and the user has an email', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should upsert the checkpoint with the provided email', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 2,
        action: 'reached',
        email: 'user@test.com',
        source: 'auth'
      })

      // No wallet resolution needed, so: upsert + update previous
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
      expect(queryText).toContain('ON CONFLICT')
    })

    it('should implicitly mark the previous checkpoint as completed', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 3,
        action: 'reached',
        email: 'user@test.com',
        source: 'auth'
      })

      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [, secondCall] = mockDb.query.mock.calls
      const queryText = secondCall[0].text ?? secondCall[0]
      expect(queryText).toContain('UPDATE onboarding_checkpoints')
      expect(queryText).toContain('completed_at')
    })
  })

  describe('and the user does not have an email (wallet-only)', () => {
    beforeEach(() => {
      // resolveWalletIdentity does a SELECT to look up email for the wallet — returns empty
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should look up email by wallet and fall back to wallet as user_id', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: '0xabc123',
        identifierType: 'wallet',
        checkpointId: 3,
        action: 'reached'
      })

      // First call is the wallet resolution query, second is the upsert
      const upsertCall = mockDb.query.mock.calls[1]
      // email value should be null in the upsert query values
      expect(upsertCall[0].values).toContain(null)
    })
  })

  describe('and checkpointId is 1 (first checkpoint)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should not attempt to update a previous checkpoint', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 1,
        action: 'reached'
      })

      expect(mockDb.query.mock.calls).toHaveLength(1) // only the upsert, no previous update
    })
  })

  describe('and the user provides a wallet field', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should include wallet in the INSERT query', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 3,
        action: 'reached',
        email: 'user@test.com',
        wallet: '0xABC123',
        source: 'auth'
      })

      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('wallet')
      // wallet should be lowercased
      expect(firstCall[0].values).toContain('0xabc123')
    })
  })
})

describe('wallet-to-email resolution', () => {
  describe('when identifierType is wallet and no email is provided', () => {
    describe('and an earlier checkpoint with that wallet exists', () => {
      beforeEach(() => {
        // First call: resolveWalletIdentity query — returns a match
        mockDb.query
          .mockResolvedValueOnce({
            rows: [{ user_id: 'user@test.com', email: 'user@test.com' }],
            rowCount: 1,
            notices: []
          })
          // Second call: INSERT (upsert)
          .mockResolvedValueOnce(emptyResult)
          // Third call: UPDATE previous checkpoint
          .mockResolvedValueOnce(emptyResult)
      })

      it('should resolve wallet to the email-based user_id', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        // Should have 3 queries: resolve + upsert + update previous
        expect(mockDb.query.mock.calls).toHaveLength(3)

        // First query should be the wallet lookup
        const [resolveCall] = mockDb.query.mock.calls
        const resolveText = resolveCall[0].text ?? resolveCall[0]
        expect(resolveText).toContain('SELECT user_id, email')
        expect(resolveText).toContain('WHERE wallet')

        // Second query (upsert) should use the resolved email as user_id
        const [, upsertCall] = mockDb.query.mock.calls
        expect(upsertCall[0].values).toContain('user@test.com') // resolved user_id
      })

      it('should use the resolved email for the checkpoint row', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        const [, upsertCall] = mockDb.query.mock.calls
        // The resolved email should appear in the values
        expect(upsertCall[0].values).toContain('user@test.com')
      })
    })

    describe('and no earlier checkpoint with that wallet exists', () => {
      beforeEach(() => {
        // First call: resolveWalletIdentity query — no match
        mockDb.query
          .mockResolvedValueOnce(emptyResult)
          // Second call: INSERT (upsert)
          .mockResolvedValueOnce(emptyResult)
          // Third call: UPDATE previous checkpoint
          .mockResolvedValueOnce(emptyResult)
      })

      it('should use the wallet as-is for user_id', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        // Should have 3 queries: resolve + upsert + update previous
        expect(mockDb.query.mock.calls).toHaveLength(3)

        // Upsert should use the original wallet as user_id
        const [, upsertCall] = mockDb.query.mock.calls
        expect(upsertCall[0].values).toContain('0xabc123')
      })
    })
  })

  describe('when identifierType is wallet but email IS provided', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should not attempt wallet resolution', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: '0xabc123',
        identifierType: 'wallet',
        checkpointId: 2,
        action: 'reached',
        email: 'already-known@test.com'
      })

      // Should have 2 queries: upsert + update previous (no resolve query)
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
    })
  })

  describe('when identifierType is email', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should not attempt wallet resolution', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 3,
        action: 'reached',
        email: 'user@test.com'
      })

      // Should have 2 queries: upsert + update previous (no resolve query)
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
    })
  })
})

describe('when recording a checkpoint with action completed', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
  })

  it('should update completed_at on the matching checkpoint row', async () => {
    await onboarding.recordCheckpoint({
      userIdentifier: 'user@test.com',
      identifierType: 'email',
      checkpointId: 3,
      action: 'completed'
    })

    expect(mockDb.query.mock.calls).toHaveLength(1)
    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).toContain('UPDATE onboarding_checkpoints')
    expect(queryText).toContain('completed_at = NOW()')
  })

  it('should not insert a new row', async () => {
    await onboarding.recordCheckpoint({
      userIdentifier: 'user@test.com',
      identifierType: 'email',
      checkpointId: 3,
      action: 'completed'
    })

    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).not.toContain('INSERT INTO')
  })

  it('should update email if provided during completion', async () => {
    await onboarding.recordCheckpoint({
      userIdentifier: '0xabc',
      identifierType: 'wallet',
      checkpointId: 3,
      action: 'completed',
      email: 'provided@test.com'
    })

    const [firstCall] = mockDb.query.mock.calls
    expect(firstCall[0].values).toContain('provided@test.com')
  })
})

describe('when getting pending nudges', () => {
  describe('for sequence 1 (12 hours)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({
        rows: [
          { user_id: 'stuck@test.com', checkpoint: 3, email: 'stuck@test.com' },
          { user_id: '0xabc', checkpoint: 2, email: 'wallet-user@test.com' }
        ],
        rowCount: 2,
        notices: []
      })
    })

    it('should query with 12 hour interval', async () => {
      await onboarding.getPendingNudges(1)

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain(12)
    })

    it('should return mapped pending nudge objects', async () => {
      const result = await onboarding.getPendingNudges(1)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' })
      expect(result[1]).toEqual({ userId: '0xabc', checkpointId: 2, email: 'wallet-user@test.com' })
    })

    it('should exclude users who have progressed to a later checkpoint (NOT EXISTS guard)', async () => {
      await onboarding.getPendingNudges(1)

      const [firstCall] = mockDb.query.mock.calls
      const queryText = firstCall[0].text ?? firstCall[0]
      expect(queryText).toContain('NOT EXISTS')
      expect(queryText).toContain('later.checkpoint > oc.checkpoint')
    })
  })

  describe('for sequence 2 (24 hours)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should query with 24 hour interval', async () => {
      await onboarding.getPendingNudges(2)

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain(24)
    })

    it('should return empty array when no pending nudges', async () => {
      const result = await onboarding.getPendingNudges(2)
      expect(result).toEqual([])
    })
  })

  describe('for sequence 3 (36 hours)', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should query with 36 hour interval', async () => {
      await onboarding.getPendingNudges(3)

      const [firstCall] = mockDb.query.mock.calls
      expect(firstCall[0].values).toContain(36)
    })
  })
})

describe('when marking a nudge as sent', () => {
  beforeEach(() => {
    mockDb.query.mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
  })

  it('should insert into email_nudges table', async () => {
    await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id-123')

    expect(mockDb.query.mock.calls).toHaveLength(1)
    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).toContain('INSERT INTO email_nudges')
  })

  it('should include the sendgrid message id', async () => {
    await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id-456')

    const [firstCall] = mockDb.query.mock.calls
    expect(firstCall[0].values).toContain('sg-msg-id-456')
  })

  it('should work without a message id', async () => {
    await expect(onboarding.markNudgeSent('user@test.com', 3, 1)).resolves.not.toThrow()

    const [firstCall] = mockDb.query.mock.calls
    expect(firstCall[0].values).toContain(null)
  })

  it('should use ON CONFLICT DO NOTHING to prevent duplicates', async () => {
    await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id')

    const [firstCall] = mockDb.query.mock.calls
    const queryText = firstCall[0].text ?? firstCall[0]
    expect(queryText).toContain('ON CONFLICT')
    expect(queryText).toContain('DO NOTHING')
  })
})
