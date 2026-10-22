import { Socket } from 'socket.io-client'
import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { TestArguments } from '@dcl/test-helpers'
import { MessageType, RequestResponseMessage, RequestValidationMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'
import { createAuthWsClient } from '../utils'
import { signTestOutcome } from '../utils/outcome'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

/**
 * Connects a desktop client and an auth-dapp client for the enclosing `test()`/`describe`
 * context. Registers its own `beforeEach` (connect) and `afterEach` (close) so the socket
 * lifecycle is owned by the context that uses it rather than by module-level state. The
 * returned getters always resolve to the sockets for the current test.
 */
function connectClients(args: TestArguments<BaseComponents>) {
  let desktopClientSocket: Socket
  let authDappSocket: Socket

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    desktopClientSocket = await createAuthWsClient(port)
    authDappSocket = await createAuthWsClient(port)
  })

  afterEach(() => {
    desktopClientSocket.close()
    authDappSocket.close()
  })

  return {
    get desktop(): Socket {
      return desktopClientSocket
    },
    get authDapp(): Socket {
      return authDappSocket
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
    signOutcome: (message: Parameters<typeof signTestOutcome>[1]) => signTestOutcome(identity, message),
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
  const clients = connectClients(args)

  it('should respond with an invalid response message', async () => {
    const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"method"},"message":"must have required property \'method\'"}]'
    })
  })
})

test('when sending a request message', args => {
  const clients = connectClients(args)

  describe('and an auth chain is not provided', () => {
    it('should respond with an invalid response message indicating that the auth chain is required', async () => {
      const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
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
      const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
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
      const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
        method: 'personal_sign',
        params: [ephemeralMessage],
        authChain: identity.authChain
      })

      expect(response).toEqual({
        error: 'Signing a Decentraland ephemeral message is not allowed'
      })
    })

    it('should respond with an invalid response message when the ephemeral message is hex encoded', async () => {
      const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
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

    it('should respond with a request response message', async () => {
      const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
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

    it('should respond with a request response message', async () => {
      const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
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
      const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: [],
        authChain: identity.authChain
      })

      const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
        requestId: requestResponse.requestId
      })

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
        const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })

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
        const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })

        expect(requestResponse.error).toEqual('Could not get final authority from auth chain')
      })
    })
  })
})

test('when sending a recover message with an invalid schema', args => {
  const clients = connectClients(args)

  it('should respond with an invalid response message', async () => {
    const response = await clients.authDapp.emitWithAck(MessageType.RECOVER, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
    })
  })
})

test('when sending a recover message but the request does not exist', args => {
  const clients = connectClients(args)
  let requestId: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
  })

  it('should respond with an invalid response message', async () => {
    const response = await clients.authDapp.emitWithAck(MessageType.RECOVER, { requestId })

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a recover message for a request that has been overridden by another one', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })

  it('should respond with a recover response message for the new request', async () => {
    await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: [],
      sender: identity.owner
    })
  })

  it('should not override the first request if it was sent by a different socket', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    await clients.authDapp.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: [],
      sender: identity.owner
    })
  })
})

test('when sending a recover message but the socket that sent it has disconnected', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  it('should still return the request data (requests survive socket disconnect)', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    clients.desktop.disconnect()

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: [],
      sender: identity.owner
    })
  })
})

test('when sending a recover message', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  it('should respond with a recover response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

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
  const clients = connectClients(args)

  it('should respond with an invalid response message', async () => {
    const response = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"result"},"message":"must have required property \'result\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"error"},"message":"must have required property \'error\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending an outcome message but the request does not exist', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()
  let requestId: string
  let sender: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
    sender = identity.owner
  })

  it('should respond with an invalid response message', async () => {
    const response = await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId,
        sender,
        result: 'result'
      })
    )

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()
  let sender: string

  beforeEach(() => {
    sender = identity.owner
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const outcomeResponse = await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending an outcome message but the socket that created the request disconnected', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()
  let sender: string

  beforeEach(() => {
    sender = identity.owner
  })

  it('should accept the outcome and store it for polling (requests survive socket disconnect)', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    clients.desktop.disconnect()

    const outcomeResponse = await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    expect(outcomeResponse).toEqual({})
  })
})

test('when the auth dapp sends an outcome message', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()
  let sender: string

  beforeEach(() => {
    sender = identity.owner
  })

  it('should respond with an empty object as ack', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const outcomeResponse = await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    expect(outcomeResponse).toEqual({})
  })

  it('should emit to the desktop client the outcome response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const outcomeResponsePromise = new Promise(resolve => {
      clients.desktop.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    const outcomeResponse = await outcomeResponsePromise

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should emit to the desktop client the outcome response message with an error', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const outcomeResponsePromise = new Promise(resolve => {
      clients.desktop.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        error: {
          code: 1233,
          message: 'anErrorOcurred'
        }
      })
    )

    const outcomeResponse = await outcomeResponsePromise

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      error: {
        code: 1233,
        message: 'anErrorOcurred'
      }
    })
  })

  it('should respond with an invalid response message if calling the output twice', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    const outcomeResponse = await clients.authDapp.emitWithAck(
      MessageType.OUTCOME,
      identity.signOutcome({
        requestId: requestResponse.requestId,
        sender,
        result: 'result'
      })
    )

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has already been fulfilled`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when posting that a request needs validation but the request has expired', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  it('should respond with an error indicating that the request has expired', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: [],
      authChain: identity.authChain
    })

    const response = await clients.authDapp.emitWithAck(MessageType.REQUEST_VALIDATION_STATUS, {
      requestId: requestResponse.requestId
    })

    expect(response).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when posting that a request needs validation but the request does not exist', args => {
  const clients = connectClients(args)
  let requestId: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
  })

  it('should respond with an error indicating that the request does not exist', async () => {
    const response = await clients.authDapp.emitWithAck(MessageType.REQUEST_VALIDATION_STATUS, { requestId })

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

test('when posting that a request needs validation and the request is valid', args => {
  const clients = connectClients(args)
  const identity = useTestIdentity()

  describe('and there is a client connected listening for the request validation', () => {
    let requestResponse: RequestResponseMessage

    beforeEach(async () => {
      requestResponse = (await clients.desktop.emitWithAck('request', {
        method: 'method',
        params: [],
        authChain: identity.authChain
      })) as RequestResponseMessage
    })

    it('should respond with an empty object as ack and send the request validation to the client', async () => {
      const promiseOfRequestValidation = new Promise<RequestValidationMessage>((resolve, _) => {
        clients.desktop.on(MessageType.REQUEST_VALIDATION_STATUS, (data: RequestValidationMessage) => {
          resolve(data)
        })
      })

      await clients.authDapp.emitWithAck(MessageType.REQUEST_VALIDATION_STATUS, {
        requestId: requestResponse.requestId
      })

      return expect(promiseOfRequestValidation).resolves.toEqual({
        requestId: requestResponse.requestId,
        code: requestResponse.code
      })
    })
  })

  describe('and there is no client connected listening for the request validation', () => {
    let requestResponse: RequestResponseMessage

    beforeEach(async () => {
      requestResponse = (await clients.desktop.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: [],
        authChain: identity.authChain
      })) as RequestResponseMessage
    })

    it('should respond with an empty object as ack', async () => {
      return expect(
        clients.authDapp.emitWithAck(MessageType.REQUEST_VALIDATION_STATUS, {
          requestId: requestResponse.requestId
        })
      ).resolves.toEqual({})
    })
  })
})
