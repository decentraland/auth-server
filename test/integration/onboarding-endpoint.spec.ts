import { IPgComponent } from '../../src/ports/db/types'
import { test } from '../components'

const AUTH_HEADER = { authorization: 'Bearer test-api-key' }
const ORIGIN = 'https://test-auth.org'

async function postCheckpoint(port: string, body: unknown, headers: Record<string, string> = AUTH_HEADER): Promise<Response> {
  return fetch(`http://localhost:${port}/onboarding/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

async function getPendingNudges(port: string, headers: Record<string, string> = AUTH_HEADER): Promise<Response> {
  return fetch(`http://localhost:${port}/onboarding/pending-nudges`, {
    method: 'GET',
    headers: { origin: ORIGIN, ...headers }
  })
}

test('when calling POST /onboarding/checkpoint', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  describe('and the payload is a valid reached checkpoint', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>
    let payload: Record<string, unknown>

    beforeEach(() => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
      payload = {
        checkpointId: 2,
        userIdentifier: 'user@test.com',
        identifierType: 'email',
        action: 'reached',
        email: 'user@test.com',
        source: 'auth',
        metadata: { loginMethod: 'email' }
      }
    })

    it('should respond with a 200 status code and success true', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    })
  })

  describe('and the payload is a completed action', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>
    let payload: Record<string, unknown>

    beforeEach(() => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1, notices: [] })
      payload = {
        checkpointId: 3,
        userIdentifier: '0xabc123',
        identifierType: 'wallet',
        action: 'completed',
        email: 'wallet-user@test.com'
      }
    })

    it('should respond with a 200 status code and success true', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    })
  })

  describe('and the Authorization header is missing', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { checkpointId: 2, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' }
    })

    it('should respond with a 401 status code', async () => {
      const response = await postCheckpoint(port, payload, {})

      expect(response.status).toBe(401)
    })
  })

  describe('and the API key is wrong', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { checkpointId: 2, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' }
    })

    it('should respond with a 401 status code', async () => {
      const response = await postCheckpoint(port, payload, { authorization: 'Bearer wrong-key' })

      expect(response.status).toBe(401)
    })
  })

  describe('and the body is malformed JSON', () => {
    it('should respond with a 400 status code rather than a 500', async () => {
      const response = await postCheckpoint(port, 'not-json')

      expect(response.status).toBe(400)
    })
  })

  describe('and the checkpointId is out of range', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { checkpointId: 99, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' }
    })

    it('should respond with a 400 status code', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(400)
    })
  })

  describe('and the checkpointId is missing', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' }
    })

    it('should respond with a 400 status code', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(400)
    })
  })

  describe('and the action is missing', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email' }
    })

    it('should respond with a 400 status code', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(400)
    })
  })

  describe('and the identifierType is invalid', () => {
    let payload: Record<string, unknown>

    beforeEach(() => {
      payload = { checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'phone', action: 'reached' }
    })

    it('should respond with a 400 status code', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(400)
    })
  })

  describe('and the database throws', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>
    let payload: Record<string, unknown>

    beforeEach(() => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      mockDb.query = jest.fn().mockRejectedValue(new Error('DB connection lost'))
      payload = { checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached' }
    })

    it('should respond with a 500 status code', async () => {
      const response = await postCheckpoint(port, payload)

      expect(response.status).toBe(500)
    })
  })

  describe('and the nudge evaluator runs after recording a checkpoint', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>
    let payload: Record<string, unknown>

    beforeEach(async () => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
      payload = { checkpointId: 3, userIdentifier: 'user@test.com', identifierType: 'email', action: 'reached', email: 'user@test.com' }
      await postCheckpoint(port, payload)
    })

    it('should record the checkpoint in the database', () => {
      expect(mockDb.query).toHaveBeenCalled()
    })

    it('should not send a nudge email when there are no pending nudges', async () => {
      await args.components.nudgeJob.runEvaluator()

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(args.components.email.sendNudge).not.toHaveBeenCalled()
    })
  })
})

test('when calling GET /onboarding/pending-nudges', args => {
  let port: string

  beforeEach(async () => {
    port = await args.components.config.requireString('HTTP_SERVER_PORT')
  })

  describe('and there are pending nudges across sequences', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>
    let status: number
    let body: Record<string, { count: number; emails: string[] }>

    beforeEach(async () => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      // One query per sequence (1, 2, 3), in order.
      mockDb.query = jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { user_id: 'a@test.com', checkpoint: 2, email: 'a@test.com' },
            { user_id: 'b@test.com', checkpoint: 2, email: 'b@test.com' },
            { user_id: 'c@test.com', checkpoint: 3, email: 'c@test.com' }
          ],
          rowCount: 3,
          notices: []
        })
        .mockResolvedValueOnce({ rows: [{ user_id: 'a@test.com', checkpoint: 2, email: 'a@test.com' }], rowCount: 1, notices: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, notices: [] })

      const response = await getPendingNudges(port)
      status = response.status
      body = await response.json()
    })

    it('should respond with a 200 status code', () => {
      expect(status).toBe(200)
    })

    it('should group the sequence 1 nudges by checkpoint', () => {
      expect(body['CP2 - seq 1']).toEqual({ count: 2, emails: ['a@test.com', 'b@test.com'] })
      expect(body['CP3 - seq 1']).toEqual({ count: 1, emails: ['c@test.com'] })
    })

    it('should group the sequence 2 nudges by checkpoint', () => {
      expect(body['CP2 - seq 2']).toEqual({ count: 1, emails: ['a@test.com'] })
    })

    it('should omit sequences that have no pending nudges', () => {
      expect(Object.keys(body).filter(key => key.includes('seq 3'))).toHaveLength(0)
    })
  })

  describe('and there are no pending nudges', () => {
    let mockDb: jest.Mocked<Pick<IPgComponent, 'query'>>

    beforeEach(() => {
      mockDb = args.components.db as unknown as jest.Mocked<Pick<IPgComponent, 'query'>>
      mockDb.query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] })
    })

    it('should respond with a 200 status code and an empty object', async () => {
      const response = await getPendingNudges(port)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
    })
  })

  describe('and the Authorization header is missing', () => {
    it('should respond with a 401 status code', async () => {
      const response = await getPendingNudges(port, {})

      expect(response.status).toBe(401)
    })
  })

  describe('and the API key is wrong', () => {
    it('should respond with a 401 status code', async () => {
      const response = await getPendingNudges(port, { authorization: 'Bearer wrong-key' })

      expect(response.status).toBe(401)
    })
  })
})
