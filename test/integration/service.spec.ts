import { Socket } from 'socket.io-client'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { TestArguments } from '@dcl/test-helpers'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { MessageType, RequestResponseMessage, RequestValidationMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'
import { createAuthWsClient } from '../utils'
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

  it('should respond with a request response message', async () => {
    const response = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    expect(response).toEqual({
      requestId: expect.any(String),
      expiration: expect.any(String),
      code: expect.any(Number)
    })
  })
})

test(`when sending a request message for a method that is not ${METHOD_DCL_PERSONAL_SIGN}`, args => {
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

  describe('and an auth chain is provided', () => {
    let testIdentity: Awaited<ReturnType<typeof createTestIdentity>>

    beforeEach(async () => {
      testIdentity = await createTestIdentity()
    })

    it('should respond with a request response message', async () => {
      const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: [],
        authChain: testIdentity.authChain
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
        authChain: testIdentity.authChain
      })

      const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
        requestId: requestResponse.requestId
      })

      expect(recoverResponse.sender).toEqual(testIdentity.authChain[0].payload.toLowerCase())
    })

    describe('and the payload on the signer link does not match the address of the ephemeral message signer', () => {
      let otherAccount: ReturnType<typeof createUnsafeIdentity>
      let modifiedAuthChain: typeof testIdentity.authChain

      beforeEach(() => {
        otherAccount = createUnsafeIdentity()
        modifiedAuthChain = [...testIdentity.authChain]
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
          `ERROR. Link type: ECDSA_EPHEMERAL. Invalid signer address. Expected: ${otherAccount.address.toLowerCase()}. Actual: ${testIdentity.authChain[0].payload.toLowerCase()}.`
        )
      })
    })

    describe('and the auth chain does not have a parsable payload in the second link', () => {
      let modifiedAuthChain: typeof testIdentity.authChain

      beforeEach(() => {
        modifiedAuthChain = [...testIdentity.authChain]
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

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  const clients = connectClients(args)

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
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

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
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
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })
  })

  it('should not override the first request if it was sent by a different socket', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await clients.authDapp.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })
  })
})

test('when sending a recover message but the socket that sent it has disconnected', args => {
  const clients = connectClients(args)

  it('should still return the request data (requests survive socket disconnect)', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    clients.desktop.disconnect()

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })
  })
})

test('when sending a recover message', args => {
  const clients = connectClients(args)

  it('should respond with a recover response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await clients.authDapp.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
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
  let requestId: string
  let sender: string

  beforeEach(() => {
    requestId = generateRandomIdentityId()
    sender = createUnsafeIdentity().address
  })

  it('should respond with an invalid response message', async () => {
    const response = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId,
      sender,
      result: 'result'
    })

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  const clients = connectClients(args)
  let sender: string

  beforeEach(() => {
    sender = createUnsafeIdentity().address
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponse = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending an outcome message but the socket that created the request disconnected', args => {
  const clients = connectClients(args)
  let sender: string

  beforeEach(() => {
    sender = createUnsafeIdentity().address
  })

  it('should accept the outcome and store it for polling (requests survive socket disconnect)', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    clients.desktop.disconnect()

    const outcomeResponse = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    expect(outcomeResponse).toEqual({})
  })
})

test('when the auth dapp sends an outcome message', args => {
  const clients = connectClients(args)
  let sender: string

  beforeEach(() => {
    sender = createUnsafeIdentity().address
  })

  it('should respond with an empty object as ack', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponse = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    expect(outcomeResponse).toEqual({})
  })

  it('should emit to the desktop client the outcome response message', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      clients.desktop.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    const outcomeResponse = await outcomeResponsePromise

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should emit to the desktop client the outcome response message with an error', async () => {
    const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      clients.desktop.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      error: {
        code: 1233,
        message: 'anErrorOcurred'
      }
    })

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
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    const outcomeResponse = await clients.authDapp.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has already been fulfilled`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })(
  'when posting that a request needs validation but the request has expired',
  args => {
    const clients = connectClients(args)

    it('should respond with an error indicating that the request has expired', async () => {
      const requestResponse = await clients.desktop.emitWithAck(MessageType.REQUEST, {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
      })

      const response = await clients.authDapp.emitWithAck(MessageType.REQUEST_VALIDATION_STATUS, {
        requestId: requestResponse.requestId
      })

      expect(response).toEqual({
        error: `Request with id "${requestResponse.requestId}" has expired`
      })
    })
  }
)

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

  describe('and there is a client connected listening for the request validation', () => {
    let requestResponse: RequestResponseMessage

    beforeEach(async () => {
      requestResponse = (await clients.desktop.emitWithAck('request', {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
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
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
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
