import { test, testWithOverrides } from '../components'

let baseUrl: string

test('when querying the liveness probe', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  it('should respond with 200 and alive', async () => {
    const response = await fetch(`${baseUrl}/health/live`)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('alive')
  })
})

test('when querying the readiness probe', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  it('should respond with 200 and pass status', async () => {
    const response = await fetch(`${baseUrl}/health/ready`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({
        status: 'pass'
      })
    )
  })
})

test('when querying the startup probe', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  it('should respond with 200 and pass status', async () => {
    const response = await fetch(`${baseUrl}/health/startup`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({
        status: 'pass'
      })
    )
  })
})

test('when querying metrics without bearer token configured', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  it('should respond with 200 and metrics payload', async () => {
    const response = await fetch(`${baseUrl}/metrics`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('http_requests_total')
    expect(body).toContain('http_request_duration_seconds')
  })
})

testWithOverrides({ metricsBearerToken: 'test-token' })('when querying metrics with bearer token configured', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    baseUrl = `http://localhost:${port}`
  })

  it('should reject requests without token', async () => {
    const response = await fetch(`${baseUrl}/metrics`)

    expect(response.status).toBe(401)
  })

  it('should reject requests with invalid token', async () => {
    const response = await fetch(`${baseUrl}/metrics`, {
      headers: {
        authorization: 'Bearer invalid-token'
      }
    })

    expect(response.status).toBe(401)
  })

  it('should respond with 200 when using a valid token', async () => {
    const response = await fetch(`${baseUrl}/metrics`, {
      headers: {
        authorization: 'Bearer test-token'
      }
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('http_requests_total')
  })
})
