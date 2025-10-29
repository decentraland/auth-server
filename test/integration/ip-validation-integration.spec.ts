import { test } from '../components'

test('when validating IP addresses during request processing with CloudFlare headers', args => {
  let requestPayload: { method: string; params: string[] }
  let requestHeaders: Record<string, string>
  let cfConnectingIp: string
  let xForwardedForIp: string
  let xRealIp: string

  beforeEach(() => {
    requestPayload = {
      method: 'dcl_personal_sign',
      params: ['Hello Decentraland']
    }
    cfConnectingIp = '203.0.113.1'
    xForwardedForIp = '203.0.113.2'
    xRealIp = '203.0.113.4'
    requestHeaders = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': cfConnectingIp,
      'X-Forwarded-For': `${xForwardedForIp}, 203.0.113.3`,
      'X-Real-IP': xRealIp
    }
  })

  it('should create request successfully and store CF-Connecting-IP', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    expect(response.status).toBe(201)
    expect(responseData.requestId).toBeDefined()

    // Verify that the CF-Connecting-IP (highest priority) was stored
    const storedRequest = args.components.storage.getRequest(responseData.requestId)
    expect(storedRequest?.originalIp).toBe(cfConnectingIp)
  })
})

test('when validating IP addresses during request processing with X-Forwarded-For headers', args => {
  let requestPayload: { method: string; params: string[] }
  let requestHeaders: Record<string, string>
  let firstForwardedIp: string
  let secondForwardedIp: string
  let xRealIp: string

  beforeEach(() => {
    requestPayload = {
      method: 'dcl_personal_sign',
      params: ['Hello Decentraland']
    }
    firstForwardedIp = '203.0.113.1'
    secondForwardedIp = '203.0.113.2'
    xRealIp = '203.0.113.3'
    requestHeaders = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `${firstForwardedIp}, ${secondForwardedIp}`,
      'X-Real-IP': xRealIp
    }
  })

  it('should create request successfully and store X-Real-IP (highest priority)', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    expect(response.status).toBe(201)
    expect(responseData.requestId).toBeDefined()

    // Verify that X-Real-IP was stored (highest priority when CF-Connecting-IP is not present)
    const storedRequest = args.components.storage.getRequest(responseData.requestId)
    expect(storedRequest?.originalIp).toBe(xRealIp)
  })
})

test('when validating IP addresses during request processing without IP headers', args => {
  let requestPayload: { method: string; params: string[] }
  let requestHeaders: Record<string, string>

  beforeEach(() => {
    requestPayload = {
      method: 'dcl_personal_sign',
      params: ['Hello Decentraland']
    }
    requestHeaders = {
      'Content-Type': 'application/json'
    }
  })

  it('should create request successfully and store "unknown" IP when no headers present', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    expect(response.status).toBe(201)
    expect(responseData.requestId).toBeDefined()

    // Verify that "unknown" was stored when no IP headers are present
    const storedRequest = args.components.storage.getRequest(responseData.requestId)
    expect(storedRequest?.originalIp).toBe('unknown')
  })
})

test('when validating IP addresses with multiple forwarded headers', args => {
  let requestPayload: { method: string; params: string[] }
  let requestHeaders: Record<string, string>
  let requestId: string

  beforeEach(() => {
    requestPayload = {
      method: 'dcl_personal_sign',
      params: ['Hello Decentraland']
    }
    requestHeaders = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.1',
      'X-Forwarded-For': '203.0.113.2, 203.0.113.3',
      'X-Real-IP': '203.0.113.4'
    }
  })

  it('should create request with first valid IP', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    requestId = responseData.requestId
    expect(response.status).toBe(201)

    // Verify that the CF-Connecting-IP (highest priority) was stored
    const storedRequest = args.components.storage.getRequest(requestId)
    expect(storedRequest?.originalIp).toBe('203.0.113.1')
  })

  it('should allow recovery with stored IP in current IPs', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    // Try to recover with headers that include the stored IP (203.0.113.1)
    const recoveryHeaders = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.1' // This matches the stored IP
    }

    const response = await fetch(`http://localhost:${serverPort}/v2/requests/${requestId}`, {
      method: 'GET',
      headers: recoveryHeaders
    })

    expect(response.status).toBe(200)
  })

  it('should allow recovery with stored IP in X-Forwarded-For', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    // Try to recover with X-Forwarded-For that includes the stored IP (203.0.113.1)
    const recoveryHeaders = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.5, 203.0.113.1, 203.0.113.6' // Stored IP is in the middle
    }

    const response = await fetch(`http://localhost:${serverPort}/v2/requests/${requestId}`, {
      method: 'GET',
      headers: recoveryHeaders
    })

    expect(response.status).toBe(200)
  })

  it('should deny recovery with IP not in current set', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    // Try to recover with a completely different IP
    const recoveryHeaders = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.999' // This is NOT the stored IP
    }

    const response = await fetch(`http://localhost:${serverPort}/v2/requests/${requestId}`, {
      method: 'GET',
      headers: recoveryHeaders
    })

    expect(response.status).toBe(403)
  })
})
