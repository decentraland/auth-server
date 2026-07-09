import { createOnboardingComponent } from '../../src/ports/onboarding/component'
import { IOnboardingComponent } from '../../src/ports/onboarding/types'
import { createMockDbComponent, createMockLogs } from '../mocks'

const emptyResult = { rows: [], rowCount: 0, notices: [] }

describe('when using the onboarding component', () => {
  let onboarding: IOnboardingComponent
  let mockDb: ReturnType<typeof createMockDbComponent>

  beforeEach(() => {
    mockDb = createMockDbComponent()
    onboarding = createOnboardingComponent({ db: mockDb, logs: createMockLogs() })
  })

  describe('and recording a checkpoint with the reached action', () => {
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
        const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
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
        const queryText = mockDb.query.mock.calls[1][0].text ?? mockDb.query.mock.calls[1][0]
        expect(queryText).toContain('UPDATE onboarding_checkpoints')
        expect(queryText).toContain('completed_at')
      })
    })

    describe('and the user is wallet-only', () => {
      beforeEach(() => {
        // resolveWalletIdentity does a SELECT to look up the email for the wallet — returns empty
        mockDb.query.mockResolvedValue(emptyResult)
      })

      it('should store a null email in the upsert after falling back to the wallet as user_id', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 3,
          action: 'reached'
        })

        // First call is the wallet resolution query, second is the upsert
        expect(mockDb.query.mock.calls[1][0].values).toContain(null)
      })
    })

    describe('and the checkpointId is the first checkpoint', () => {
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

    describe('and a wallet field is provided', () => {
      beforeEach(() => {
        mockDb.query.mockResolvedValue(emptyResult)
      })

      it('should include the lowercased wallet in the INSERT query', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: 'user@test.com',
          identifierType: 'email',
          checkpointId: 3,
          action: 'reached',
          email: 'user@test.com',
          wallet: '0xABC123',
          source: 'auth'
        })

        const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
        expect(queryText).toContain('wallet')
        expect(mockDb.query.mock.calls[0][0].values).toContain('0xabc123')
      })
    })
  })

  describe('and recording a wallet checkpoint without an email', () => {
    describe('and an earlier checkpoint with that wallet exists', () => {
      beforeEach(() => {
        mockDb.query
          // First call: resolveWalletIdentity query — returns a match
          .mockResolvedValueOnce({ rows: [{ user_id: 'user@test.com', email: 'user@test.com' }], rowCount: 1, notices: [] })
          // Second call: INSERT (upsert)
          .mockResolvedValueOnce(emptyResult)
          // Third call: UPDATE previous checkpoint
          .mockResolvedValueOnce(emptyResult)
      })

      it('should look up the wallet with a SELECT query', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        const resolveText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
        expect(resolveText).toContain('SELECT user_id, email')
        expect(resolveText).toContain('WHERE wallet')
      })

      it('should upsert the checkpoint using the resolved email-based user_id', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        expect(mockDb.query.mock.calls[1][0].values).toContain('user@test.com')
      })
    })

    describe('and no earlier checkpoint with that wallet exists', () => {
      beforeEach(() => {
        mockDb.query
          // First call: resolveWalletIdentity query — no match
          .mockResolvedValueOnce(emptyResult)
          // Second call: INSERT (upsert)
          .mockResolvedValueOnce(emptyResult)
          // Third call: UPDATE previous checkpoint
          .mockResolvedValueOnce(emptyResult)
      })

      it('should upsert the checkpoint using the wallet as the user_id', async () => {
        await onboarding.recordCheckpoint({
          userIdentifier: '0xabc123',
          identifierType: 'wallet',
          checkpointId: 7,
          action: 'reached',
          source: 'explorer'
        })

        expect(mockDb.query.mock.calls[1][0].values).toContain('0xabc123')
      })
    })
  })

  describe('and recording a wallet checkpoint with an email already provided', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should skip wallet resolution and go straight to the upsert', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: '0xabc123',
        identifierType: 'wallet',
        checkpointId: 2,
        action: 'reached',
        email: 'already-known@test.com'
      })

      // Only the upsert + update previous (no resolve query)
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
    })
  })

  describe('and recording an email checkpoint', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue(emptyResult)
    })

    it('should skip wallet resolution and go straight to the upsert', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        checkpointId: 3,
        action: 'reached',
        email: 'user@test.com'
      })

      // Only the upsert + update previous (no resolve query)
      expect(mockDb.query.mock.calls).toHaveLength(2)
      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
      expect(queryText).toContain('INSERT INTO onboarding_checkpoints')
    })
  })

  describe('and recording a checkpoint with the completed action', () => {
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
      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
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

      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
      expect(queryText).not.toContain('INSERT INTO')
    })

    it('should update the email when one is provided during completion', async () => {
      await onboarding.recordCheckpoint({
        userIdentifier: '0xabc',
        identifierType: 'wallet',
        checkpointId: 3,
        action: 'completed',
        email: 'provided@test.com'
      })

      expect(mockDb.query.mock.calls[0][0].values).toContain('provided@test.com')
    })
  })

  describe('and getting pending nudges', () => {
    describe('and the sequence is 1', () => {
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

      it('should query with a 12 hour interval', async () => {
        await onboarding.getPendingNudges(1)

        expect(mockDb.query.mock.calls[0][0].values).toContain(12)
      })

      it('should return the mapped pending nudge objects', async () => {
        const result = await onboarding.getPendingNudges(1)

        expect(result).toEqual([
          { userId: 'stuck@test.com', checkpointId: 3, email: 'stuck@test.com' },
          { userId: '0xabc', checkpointId: 2, email: 'wallet-user@test.com' }
        ])
      })

      it('should exclude users who have progressed to a later checkpoint', async () => {
        await onboarding.getPendingNudges(1)

        const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
        expect(queryText).toContain('NOT EXISTS')
        expect(queryText).toContain('later.checkpoint > oc.checkpoint')
      })
    })

    describe('and the sequence is 2', () => {
      beforeEach(() => {
        mockDb.query.mockResolvedValue(emptyResult)
      })

      it('should query with a 24 hour interval', async () => {
        await onboarding.getPendingNudges(2)

        expect(mockDb.query.mock.calls[0][0].values).toContain(24)
      })

      it('should return an empty array', async () => {
        expect(await onboarding.getPendingNudges(2)).toEqual([])
      })
    })

    describe('and the sequence is 3', () => {
      beforeEach(() => {
        mockDb.query.mockResolvedValue(emptyResult)
      })

      it('should query with a 36 hour interval', async () => {
        await onboarding.getPendingNudges(3)

        expect(mockDb.query.mock.calls[0][0].values).toContain(36)
      })
    })
  })

  describe('and marking a nudge as sent', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
    })

    it('should insert into the email_nudges table', async () => {
      await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id-123')

      expect(mockDb.query.mock.calls).toHaveLength(1)
      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
      expect(queryText).toContain('INSERT INTO email_nudges')
    })

    it('should include the sendgrid message id', async () => {
      await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id-456')

      expect(mockDb.query.mock.calls[0][0].values).toContain('sg-msg-id-456')
    })

    it('should store a null message id when none is provided', async () => {
      await expect(onboarding.markNudgeSent('user@test.com', 3, 1)).resolves.not.toThrow()

      expect(mockDb.query.mock.calls[0][0].values).toContain(null)
    })

    it('should use ON CONFLICT DO NOTHING to prevent duplicates', async () => {
      await onboarding.markNudgeSent('user@test.com', 3, 1, 'sg-msg-id')

      const queryText = mockDb.query.mock.calls[0][0].text ?? mockDb.query.mock.calls[0][0]
      expect(queryText).toContain('ON CONFLICT')
      expect(queryText).toContain('DO NOTHING')
    })
  })
})
