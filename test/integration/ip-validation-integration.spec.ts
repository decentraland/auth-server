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

  it('should create request successfully', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    expect(response.status).toBe(201)
  })

  it('should return valid requestId', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    expect(responseData.requestId).toBeDefined()
  })

  it('should store request with CloudFlare IP', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
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

  it('should create request successfully', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    expect(response.status).toBe(201)
  })

  it('should store request with X-Real-IP instead of X-Forwarded-For', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
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

  it('should create request successfully', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    expect(response.status).toBe(201)
  })

  it('should store request with "unknown" IP', async () => {
    const serverPort = await args.components.config.requireString('HTTP_SERVER_PORT')

    const response = await fetch(`http://localhost:${serverPort}/requests`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload)
    })

    const responseData = await response.json()
    const storedRequest = args.components.storage.getRequest(responseData.requestId)

    expect(storedRequest?.originalIp).toBe('unknown')
  })
})
