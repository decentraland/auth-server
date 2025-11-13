import { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { Socket } from 'socket.io-client'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { Method, RequestResponseMessage } from '../../src/ports/server/types'
import { test, testWithOverrides } from '../components'
import { createHttpClient, createAuthWsClient, HttpPollingClient } from '../utils'
import { generateRandomIdentityId } from '../utils/test-identity'

let httpClient: HttpPollingClient
let wsClient: Socket<DefaultEventsMap, DefaultEventsMap>

afterEach(() => {
  if (wsClient && wsClient.connected) {
    wsClient.close()
  }
})

test(`when sending a request message with ${Method.DCL_PERSONAL_SIGN_WITH_TOKEN}`, args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with the data of the request', async () => {
    const requestResponse = await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })

    expect(requestResponse).toEqual({
      requestId: expect.any(String),
      expiration: expect.any(String),
      code: expect.any(Number)
    })
  })

  it('should respond with the recover data of the request', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    const recoverResponse = await httpClient.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })
  })
})

test(`when sending an outcome message for ${Method.DCL_PERSONAL_SIGN_WITH_TOKEN}`, args => {
  let sender: string
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage
  })

  it('should respond with token and deepLink', async () => {
    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')

    expect(outcomeResponse).toEqual({
      token: expect.any(String),
      deepLink: expect.stringMatching(/^decentraland:\/\/\?sign_in&token=/)
    })
  })

  it('should include the token in the deep link', async () => {
    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')

    if (outcomeResponse && 'token' in outcomeResponse && 'deepLink' in outcomeResponse) {
      expect(outcomeResponse.deepLink).toContain(outcomeResponse.token)
    } else {
      throw new Error('Expected token and deepLink in response')
    }
  })
})

test('when redeeming a login token with valid data', args => {
  let sender: string
  let requestResponse: RequestResponseMessage
  let token: string

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')

    if (outcomeResponse && 'token' in outcomeResponse && outcomeResponse.token) {
      token = outcomeResponse.token
    } else {
      throw new Error('Expected token in response')
    }
  })

  it('should return the auth chain data', async () => {
    const redeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, token)

    expect(redeemResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'signature'
    })
  })

  it('should delete the request after successful redemption', async () => {
    await httpClient.redeemLoginToken(requestResponse.requestId, token)

    const secondRedeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, token)

    expect(secondRedeemResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })
})

test('when redeeming a login token with invalid token', args => {
  let sender: string
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')
  })

  it('should respond with an invalid token error', async () => {
    const redeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, 'invalid-token')

    expect(redeemResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has an invalid token.`
    })
  })

  it('should delete the request after invalid token attempt', async () => {
    await httpClient.redeemLoginToken(requestResponse.requestId, 'invalid-token')

    const secondRedeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, 'invalid-token')

    expect(secondRedeemResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })
})

test('when redeeming a login token but the request does not exist', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with a not found error', async () => {
    const requestId = generateRandomIdentityId()
    const redeemResponse = await httpClient.redeemLoginToken(requestId, 'some-token')

    expect(redeemResponse).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when redeeming a login token but the request has expired', args => {
  let sender: string
  let requestResponse: RequestResponseMessage
  let token: string

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')

    if (outcomeResponse && 'token' in outcomeResponse && outcomeResponse.token) {
      token = outcomeResponse.token
    } else {
      throw new Error('Expected token in response')
    }
  })

  it('should still allow token redemption if outcome was sent before expiration', async () => {
    // Even though the request is technically expired, if the outcome was sent
    // and token generated before expiration, it should still work
    const redeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, token)

    expect(redeemResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'signature'
    })
  })
})

test('when redeeming a login token but the response is not ready', args => {
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage
  })

  it('should respond with a response not found error', async () => {
    const redeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, 'some-token')

    expect(redeemResponse).toEqual({
      error: 'Response not found'
    })
  })
})

test('when redeeming a login token for a non-token method', args => {
  let sender: string
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    // Create a standard dcl_personal_sign request (not token-based)
    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')
  })

  it('should respond with an invalid method error', async () => {
    const redeemResponse = await httpClient.redeemLoginToken(requestResponse.requestId, 'some-token')

    expect(redeemResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" is invalid. Use Sign in with token method`
    })
  })
})

test('when redeeming a login token via WebSocket', args => {
  let sender: string
  let requestResponse: RequestResponseMessage
  let token: string

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    wsClient = await createAuthWsClient(port)
    httpClient = await createHttpClient(port)
    sender = createUnsafeIdentity().address

    requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN_WITH_TOKEN,
      params: ['ephemeral message']
    })) as RequestResponseMessage

    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'signature')

    if (outcomeResponse && 'token' in outcomeResponse && outcomeResponse.token) {
      token = outcomeResponse.token
    } else {
      throw new Error('Expected token in response')
    }
  })

  it('should return the auth chain data via WebSocket', async () => {
    const redeemResponse = await wsClient.emitWithAck('redeem_login_token', {
      requestId: requestResponse.requestId,
      token
    })

    expect(redeemResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'signature'
    })
  })

  it('should respond with error for invalid token via WebSocket', async () => {
    const redeemResponse = await wsClient.emitWithAck('redeem_login_token', {
      requestId: requestResponse.requestId,
      token: 'invalid-token'
    })

    expect(redeemResponse).toEqual({
      error: 'Invalid token'
    })
  })
})
