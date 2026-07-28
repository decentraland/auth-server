import { Socket } from 'socket.io-client'
import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { TestArguments } from '@dcl/test-helpers'
import { MessageType, OutcomeResponseMessage, RequestResponseMessage, RequestValidationMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'
import { createHttpClient, createAuthWsClient, HttpPollingClient } from '../utils'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

/**
 * Sets up an HTTP polling client (and, when `withWebSocket` is set, a socket.io client) for the
 * enclosing context. Registers its own `beforeEach`/`afterEach` so the socket lifecycle is owned
 * by the context that uses it rather than by module-level state. The HTTP client is a fetch
 * wrapper with no handle to release, so only the websocket is closed on teardown.
 */
function usePollingClients(args: TestArguments<BaseComponents>, { withWebSocket = false }: { withWebSocket?: boolean } = {}) {
  let httpClient: HttpPollingClient
  let wsClient: Socket

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    if (withWebSocket) {
      wsClient = await createAuthWsClient(port)
    }
  })

  afterEach(() => {
    if (wsClient && wsClient.connected) {
      wsClient.close()
    }
  })

  return {
    get http(): HttpPollingClient {
      return httpClient
    },
    get ws(): Socket {
      if (!wsClient) {
        throw new Error('websocket client not initialized — call usePollingClients(args, { withWebSocket: true })')
      }
      return wsClient
    }
  }
}

/**
 * Creates a fresh auth identity for the enclosing `test()`/`describe` context. Every request
 * requires a valid auth chain, so each test that registers one needs an identity. Registers its
 * own `beforeEach` so the identity is scoped to the current test.
 */
function useTestIdentity() {
  let identity: AuthIdentity

  beforeEach(async () => {
    identity = await createTestIdentity()
  })

  return {
    get authChain(): AuthIdentity['authChain'] {
      return identity.authChain
    },
    /** The owner address the server derives from the auth chain and stores as the request sender. */
    get owner(): string {
      return identity.authChain[0].payload.toLowerCase()
    }
  }
}

test('when sending a request message with an invalid schema', args => {
  const clients = usePollingClients(args)

  it('should respond with an invalid response message', async () => {
    const response = await clients.http.request({})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"method"},"message":"must have required property \'method\'"}]'
    })
  })
})

test('when sending a request message', args => {
  const clients = usePollingClients(args)

  describe('and an auth chain is not provided', () => {
    it('should respond with an invalid response message indicating that the auth chain is required', async () => {
      const response = await clients.http.request({
        method: 'method',
        params: []
      })

      expect(response).toEqual({
        error: 'Auth chain is required'
      })
    })
  })

  describe('and the method is dcl_personal_sign', () => {
    const identity = useTestIdentity()

    it('should respond with an invalid response message indicating that the method is not allowed', async () => {
      const response = await clients.http.request({
        method: 'dcl_personal_sign',
        params: [],
        authChain: identity.authChain
      })

      expect(response).toEqual({
        error: 'The dcl_personal_sign method is not allowed'
      })
    })
  })

  describe('and the method signs a Decentraland ephemeral message', () => {
    const identity = useTestIdentity()
    let ephemeralMessage: string

    beforeEach(() => {
      ephemeralMessage = Authenticator.getEphemeralMessage(
        '0x1234567890123456789012345678901234567890',
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      )
    })

    it('should respond with an invalid response message indicating that signing an ephemeral message is not allowed', async () => {
      const response = await clients.http.request({
        method: 'personal_sign',
        params: [ephemeralMessage],
        authChain: identity.authChain
      })

      expect(response).toEqual({
        error: 'Signing a Decentraland ephemeral message is not allowed'
      })
    })

    it('should respond with an invalid response message when the ephemeral message is hex encoded', async () => {
      const response = await clients.http.request({
        method: 'personal_sign',
        params: [`0x${Buffer.from(ephemeralMessage, 'utf8').toString('hex')}`],
        authChain: identity.authChain
      })

      expect(response).toEqual({
        error: 'Signing a Decentraland ephemeral message is not allowed'
      })
    })
  })

  describe('and the method signs an ordinary message', () => {
    const identity = useTestIdentity()

    it('should respond with the data of the request', async () => {
      const response = await clients.http.request({
        method: 'personal_sign',
        params: ['Please sign to confirm your order', '0x1234567890123456789012345678901234567890'],
        authChain: identity.authChain
      })

      expect(response).toEqual({
        requestId: expect.any(String),
        expiration: expect.any(String),
        code: expect.any(Number)
      })
    })
  })

  describe('and an auth chain is provided', () => {
    const identity = useTestIdentity()

    it('should respond with the data of the request', async () => {
      const requestResponse = await clients.http.request({
        method: 'method',
        params: [],
        authChain: identity.authChain
      })

      expect(requestResponse).toEqual({
        requestId: expect.any(String),
        expiration: expect.any(String),
        code: expect.any(Number)
      })
    })

    it('should return the sender derived from the auth chain on the recover response', async () => {
      const requestResponse = (await clients.http.request({
        method: 'method',
        params: [],
        authChain: identity.authChain
      })) as RequestResponseMessage

      const recoverResponse = await clients.http.recover(requestResponse.requestId)

      expect(recoverResponse.sender).toEqual(identity.owner)
    })

    describe('and the payload on the signer link does not match the address of the ephemeral message signer', () => {
      let otherAccount: ReturnType<typeof createUnsafeIdentity>
      let modifiedAuthChain: AuthIdentity['authChain']

      beforeEach(() => {
        otherAccount = createUnsafeIdentity()
        modifiedAuthChain = [...identity.authChain]
        modifiedAuthChain[0] = {
          ...modifiedAuthChain[0],
          payload: otherAccount.address
        }
      })

      it('should respond with an invalid response message, indicating that the expected signer address is different', async () => {
        const requestResponse = (await clients.http.request({
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })) as { error: string }

        expect(requestResponse.error).toEqual(
          `ERROR. Link type: ECDSA_EPHEMERAL. Invalid signer address. Expected: ${otherAccount.address.toLowerCase()}. Actual: ${
            identity.owner
          }.`
        )
      })
    })

    describe('and the auth chain does not have a parsable payload in the second link', () => {
      let modifiedAuthChain: AuthIdentity['authChain']

      beforeEach(() => {
        modifiedAuthChain = [...identity.authChain]
        modifiedAuthChain[1] = {
          ...modifiedAuthChain[1],
          payload: 'unparsable'
        }
      })

      it('should respond with an invalid response message, indicating that the final authority could not be obtained', async () => {
        const requestResponse = (await clients.http.request({
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })) as { error: string }

        expect(requestResponse.error).toEqual('Could not get final authority from auth chain')
      })
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const recoverResponse = await clients.http.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a recover message', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()

  it('should respond with the recover data of the request', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const recoverResponse = await clients.http.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: [],
      sender: identity.owner
    })
  })
})

test('when sending an outcome message with an invalid schema', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const response = await clients.http.sendSuccessfulOutcome(requestResponse.requestId, 'sender', undefined)

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"result"},"message":"must have required property \'result\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"error"},"message":"must have required property \'error\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending an outcome message but the request does not exist', args => {
  const clients = usePollingClients(args)
  let requestId: string
  let sender: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
    sender = createUnsafeIdentity().address
  })

  it('should respond with an invalid response message', async () => {
    const response = await clients.http.sendSuccessfulOutcome(requestId, sender, 'result')

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()
  let sender: string

  beforeEach(() => {
    sender = createUnsafeIdentity().address
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const outcomeResponse = await clients.http.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a valid outcome message with the HTTP endpoints', args => {
  const clients = usePollingClients(args, { withWebSocket: true })
  const identity = useTestIdentity()
  let sender: string

  beforeEach(() => {
    sender = createUnsafeIdentity().address
  })

  it('should respond with the outcome response message', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    await clients.http.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    const outcomeResponse = await clients.http.getOutcome(requestResponse.requestId)

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should relay the HTTP-submitted outcome to the connected websocket client', async () => {
    const requestResponse = (await clients.ws.emitWithAck('request', {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const promiseOfAnOutcome = new Promise<OutcomeResponseMessage>((resolve, _) => {
      clients.ws.on(MessageType.OUTCOME, (data: OutcomeResponseMessage) => {
        resolve(data)
      })
    })

    await clients.http.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    return expect(promiseOfAnOutcome).resolves.toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should respond with the outcome response message with an error', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    await clients.http.sendFailedOutcome(requestResponse.requestId, sender, {
      code: 1233,
      message: 'anErrorOccurred'
    })

    const outcomeResponse = await clients.http.getOutcome(requestResponse.requestId)

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      error: {
        code: 1233,
        message: 'anErrorOccurred'
      }
    })
  })

  it('should respond with an invalid response message if calling the output twice', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    await clients.http.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    const outcomeResponse = await clients.http.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" already has a response`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when posting that a request needs validation but the request has expired', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()

  it('should respond with a 410 and an expired response message', async () => {
    const requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    const response = await clients.http.notifyRequestValidation(requestResponse.requestId)

    expect(response).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when posting that a request needs validation but the request does not exist', args => {
  const clients = usePollingClients(args)
  let requestId: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
  })

  it('should respond with a 404 and a not found response message', async () => {
    const response = await clients.http.notifyRequestValidation(requestId)

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

test('when posting that a request needs validation and the request is valid', args => {
  const clients = usePollingClients(args, { withWebSocket: true })
  const identity = useTestIdentity()

  describe('and there is a client connected listening for the request validation', () => {
    let requestResponse: RequestResponseMessage

    beforeEach(async () => {
      requestResponse = (await clients.ws.emitWithAck('request', {
        method: 'method',
        params: [],
        authChain: identity.authChain
      })) as RequestResponseMessage
    })

    it('should respond with a 204 and send the request validation to the client', async () => {
      const promiseOfRequestValidation = new Promise<RequestValidationMessage>((resolve, _) => {
        clients.ws.on(MessageType.REQUEST_VALIDATION_STATUS, (data: RequestValidationMessage) => {
          resolve(data)
        })
      })

      await clients.http.notifyRequestValidation(requestResponse.requestId)

      return expect(promiseOfRequestValidation).resolves.toEqual({
        requestId: requestResponse.requestId
      })
    })
  })

  describe('and there is no client connected listening for the request validation', () => {
    let requestResponse: RequestResponseMessage

    beforeEach(async () => {
      requestResponse = (await clients.http.request({
        method: 'method',
        params: [],
        authChain: identity.authChain
      })) as RequestResponseMessage
    })

    it('should respond with a 204 and a valid response message', async () => {
      return expect(clients.http.notifyRequestValidation(requestResponse.requestId)).resolves.toBeUndefined()
    })
  })
})

test('when getting the request validation status of a request that should not be validated', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage
  })

  it('should respond with a 200 and the request validation status as false', async () => {
    const response = await clients.http.getRequestValidationStatus(requestResponse.requestId)

    expect(response).toEqual({
      requiresValidation: false
    })
  })
})

test('when getting the request validation status of a request that should be validated', args => {
  const clients = usePollingClients(args)
  const identity = useTestIdentity()
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    requestResponse = (await clients.http.request({
      method: 'method',
      params: [],
      authChain: identity.authChain
    })) as RequestResponseMessage

    await clients.http.notifyRequestValidation(requestResponse.requestId)
  })

  it('should respond with a 200 and the request validation status as true', async () => {
    const response = await clients.http.getRequestValidationStatus(requestResponse.requestId)

    expect(response).toEqual({
      requiresValidation: true
    })
  })
})
