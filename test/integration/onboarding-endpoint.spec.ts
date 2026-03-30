import { IPgComponent } from '../../src/ports/db/types'
import { test } from '../components'

const AUTH_HEADER = { authorization: 'Bearer test-api-key' }

test('when calling POST /onboarding/checkpoint with a valid reached payload', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
  })

  it('should respond with 200 and success true', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({
        checkpointId: 2,
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        action: 'reached',
        email: 'user@test.com',
        source: 'auth',
        metadata: { loginMethod: 'email' }
      })
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true })
  })
})

test('when calling POST /onboarding/checkpoint with a completed action', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
  })

  it('should respond with 200 and success true', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({
        checkpointId: 3,
        userIdentifier: '0xabc123',
        identifierType: 'wallet',
        action: 'completed',
        email: 'wallet-user@test.com'
      })
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true })
  })
})

test('when calling POST /onboarding/checkpoint with no Authorization header', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should respond with 401', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org' },
      body: JSON.stringify({ checkpointId: 2, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' })
    })

    expect(response.status).toBe(401)
  })
})

test('when calling POST /onboarding/checkpoint with a wrong API key', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should respond with 401', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', authorization: 'Bearer wrong-key' },
      body: JSON.stringify({ checkpointId: 2, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' })
    })

    expect(response.status).toBe(401)
  })
})

test('when calling POST /onboarding/checkpoint with an invalid checkpointId', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should respond with 400', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({ checkpointId: 99, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' })
    })

    expect(response.status).toBe(400)
  })
})

test('when calling POST /onboarding/checkpoint with missing required fields', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should respond with 400 when checkpointId is missing', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({ userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' })
    })

    expect(response.status).toBe(400)
  })

  it('should respond with 400 when action is missing', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({ checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email' })
    })

    expect(response.status).toBe(400)
  })

  it('should respond with 400 when identifierType is invalid', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({ checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'phone', action: 'reached' })
    })

    expect(response.status).toBe(400)
  })
})

test('when calling POST /onboarding/checkpoint and the DB throws', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    mockDb.query = jest.fn().mockRejectedValue(new Error('DB connection lost'))
  })

  it('should respond with 500', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({ checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' })
    })

    expect(response.status).toBe(500)
  })
})

test('when calling POST /onboarding/checkpoint and the nudge evaluator is run', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
  })

  it('should record the checkpoint and allow cron to query pending nudges', async () => {
    // Record checkpoint
    await fetch(`http://localhost:${port}/onboarding/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://test-auth.org', ...AUTH_HEADER },
      body: JSON.stringify({
        checkpointId: 3,
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        action: 'reached',
        email: 'user@test.com'
      })
    })

    // Verify onboarding.recordCheckpoint was called (via db.query)
    expect(mockDb.query).toHaveBeenCalled()

    // Run evaluator and verify it queries for pending nudges
    await args.components.nudgeJob.runEvaluator()
    // email.sendNudge is mocked to return 'mock-sg-message-id'
    // Since db.query is mocked to return empty rows, no nudges will be found
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(args.components.email.sendNudge).not.toHaveBeenCalled()
  })
})

// ── GET /onboarding/pending-nudges ────────────────────────────────────────────

test('when calling GET /onboarding/pending-nudges with valid auth and pending nudges', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    // Return different results per sequence call
    let callCount = 0
    mockDb.query = jest.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // seq 1: two CP2 nudges, one CP3 nudge
        return {
          rows: [
            { user_id: 'a@test.com', checkpoint: 2, email: 'a@test.com' },
            { user_id: 'b@test.com', checkpoint: 2, email: 'b@test.com' },
            { user_id: 'c@test.com', checkpoint: 3, email: 'c@test.com' }
          ],
          rowCount: 3,
          notices: []
        }
      }
      if (callCount === 2) {
        // seq 2: one CP2 nudge
        return { rows: [{ user_id: 'a@test.com', checkpoint: 2, email: 'a@test.com' }], rowCount: 1, notices: [] }
      }
      // seq 3: empty
      return { rows: [], rowCount: 0, notices: [] }
    })
  })

  it('should return grouped pending nudges by CP and sequence', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/pending-nudges`, {
      method: 'GET',
      headers: { origin: 'https://test-auth.org', ...AUTH_HEADER }
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body['CP2 - seq 1']).toEqual({ count: 2, emails: ['a@test.com', 'b@test.com'] })
    expect(body['CP3 - seq 1']).toEqual({ count: 1, emails: ['c@test.com'] })
    expect(body['CP2 - seq 2']).toEqual({ count: 1, emails: ['a@test.com'] })
    // seq 3 has no nudges, so no keys for it
    expect(Object.keys(body).filter(k => k.includes('seq 3'))).toHaveLength(0)
  })
})

test('when calling GET /onboarding/pending-nudges with no pending nudges', args => {
  let port: string
  let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
    mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
    mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
  })

  it('should return an empty object', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/pending-nudges`, {
      method: 'GET',
      headers: { origin: 'https://test-auth.org', ...AUTH_HEADER }
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({})
  })
})

test('when calling GET /onboarding/pending-nudges without auth', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should return 401', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/pending-nudges`, {
      method: 'GET',
      headers: { origin: 'https://test-auth.org' }
    })

    expect(response.status).toBe(401)
  })
})

test('when calling GET /onboarding/pending-nudges with wrong API key', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  it('should return 401', async () => {
    const response = await fetch(`http://localhost:${port}/onboarding/pending-nudges`, {
      method: 'GET',
      headers: { origin: 'https://test-auth.org', authorization: 'Bearer wrong-key' }
    })

    expect(response.status).toBe(401)
  })
})
