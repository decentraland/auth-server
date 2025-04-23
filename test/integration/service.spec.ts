import { TestArguments } from '@well-known-components/test-helpers'
import { ethers } from 'ethers'
import { Socket } from 'socket.io-client'
import { AuthChain, Authenticator, AuthLinkType } from '@dcl/crypto'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { MessageType, RequestResponseMessage, RequestValidationMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'
import { createAuthWsClient } from '../utils'

let desktopClientSocket: Socket
let authDappSocket: Socket

afterEach(() => {
  desktopClientSocket.close()
  authDappSocket.close()
})

async function connectClients(args: TestArguments<BaseComponents>) {
  const port = await args.components.config.requireString('HTTP_SERVER_PORT')

  desktopClientSocket = await createAuthWsClient(port)
  authDappSocket = await createAuthWsClient(port)
}

test('when sending a request message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"method"},"message":"must have required property \'method\'"}]'
    })
  })
})

test('when sending a request message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a request response message', async () => {
    const response = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
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
  let mainAccount: ethers.HDNodeWallet
  let ephemeralAccount: ethers.HDNodeWallet
  let expiration: Date
  let ephemeralMessage: string
  let signature: string
  let authChain: AuthChain

  beforeEach(async () => {
    await connectClients(args)

    mainAccount = ethers.Wallet.createRandom()
    ephemeralAccount = ethers.Wallet.createRandom()
    expiration = new Date(Date.now() + 60000) // 1 minute
    ephemeralMessage = Authenticator.getEphemeralMessage(ephemeralAccount.address, expiration)
    signature = await mainAccount.signMessage(ephemeralMessage)

    authChain = [
      {
        type: AuthLinkType.SIGNER,
        payload: mainAccount.address,
        signature: ''
      },
      {
        type: AuthLinkType.ECDSA_PERSONAL_EPHEMERAL,
        payload: ephemeralMessage,
        signature: signature
      }
    ]
  })

  describe('when an auth chain is not provided', () => {
    it('should respond with an invalid response message indicating that the auth chain is required', async () => {
      const response = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: []
      })

      expect(response).toEqual({
        error: 'Auth chain is required'
      })
    })
  })

  describe('when an auth chain is provided', () => {
    it('should respond with a request response message', async () => {
      const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: [],
        authChain
      })

      expect(requestResponse).toEqual({
        requestId: expect.any(String),
        expiration: expect.any(String),
        code: expect.any(Number)
      })
    })

    it('should return the sender derived from the auth chain on the recover response', async () => {
      const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
        method: 'method',
        params: [],
        authChain
      })

      const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
        requestId: requestResponse.requestId
      })

      expect(recoverResponse.sender).toEqual(mainAccount.address.toLowerCase())
    })

    describe('when the payload on the signer link does not match the address of the ephemeral message signer', () => {
      let otherAccount: ethers.HDNodeWallet

      beforeEach(() => {
        otherAccount = ethers.Wallet.createRandom()

        authChain[0].payload = otherAccount.address
      })

      it('should respond with an invalid response message, indicating that the expected signer address is different', async () => {
        const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
          method: 'method',
          params: [],
          authChain
        })

        expect(requestResponse.error).toEqual(
          `ERROR. Link type: ECDSA_EPHEMERAL. Invalid signer address. Expected: ${otherAccount.address.toLowerCase()}. Actual: ${mainAccount.address.toLowerCase()}.`
        )
      })
    })

    describe('when the auth chain does not have a parsable payload in the second link', () => {
      beforeEach(() => {
        authChain[1].payload = 'unparsable'
      })

      it('should respond with an invalid response message, indicating that the final authority could not be obtained', async () => {
        const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
          method: 'method',
          params: [],
          authChain
        })

        expect(requestResponse.error).toEqual('Could not get final authority from auth chain')
      })
    })
  })
})

test('when sending a recover message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await authDappSocket.emitWithAck(MessageType.RECOVER, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
    })
  })
})

test('when sending a recover message but the request does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: 'requestId'
    })

    expect(response).toEqual({
      error: 'Request with id "requestId" not found'
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a recover message for a request that has been overridden by another one', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })

  it('should respond with a recover response message for the new request', async () => {
    await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
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
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await authDappSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
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
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    desktopClientSocket.disconnect()

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })
})

test('when sending a recover message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
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
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await authDappSocket.emitWithAck(MessageType.OUTCOME, {})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"result"},"message":"must have required property \'result\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"error"},"message":"must have required property \'error\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending an outcome message but the request does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: 'requestId',
      sender: 'sender',
      result: 'result'
    })

    expect(response).toEqual({
      error: 'Request with id "requestId" not found'
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponse = await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending an outcome message but the socket that created the request disconnected', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    desktopClientSocket.disconnect()

    const outcomeResponse = await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })
})

test('when the auth dapp sends an outcome message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an empty object as ack', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponse = await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    expect(outcomeResponse).toEqual({})
  })

  it('should emit to the desktop client the outcome response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      desktopClientSocket.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    const outcomeResponse = await outcomeResponsePromise

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })
  })

  it('should emit to the desktop client the outcome response message with an error', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      desktopClientSocket.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      error: {
        code: 1233,
        message: 'anErrorOcurred'
      }
    })

    const outcomeResponse = await outcomeResponsePromise

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender: 'sender',
      error: {
        code: 1233,
        message: 'anErrorOcurred'
      }
    })
  })

  it('should respond with an invalid response message if calling the output twice', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    const outcomeResponse = await authDappSocket.emitWithAck(MessageType.OUTCOME, {
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" not found`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })(
  'when posting that a request needs validation but the request has expired',
  args => {
    beforeEach(async () => {
      await connectClients(args)
    })

    it('should respond with an error indicating that the request has expired', async () => {
      const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
      })

      const response = await authDappSocket.emitWithAck(MessageType.REQUEST_VALIDATION, {
        requestId: requestResponse.requestId
      })

      expect(response).toEqual({
        error: `Request with id "${requestResponse.requestId}" has expired`
      })
    })
  }
)

test('when posting that a request needs validation but the request does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an error indicating that the request does not exist', async () => {
    const response = await authDappSocket.emitWithAck(MessageType.REQUEST_VALIDATION, {
      requestId: 'requestId'
    })

    expect(response).toEqual({
      error: 'Request with id "requestId" not found'
    })
  })
})

test('when posting that a request needs validation and the request is valid', args => {
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    await connectClients(args)
  })

  describe('and there is a client connected listening for the request validation', () => {
    beforeEach(async () => {
      requestResponse = (await desktopClientSocket.emitWithAck('request', {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
      })) as RequestResponseMessage
    })

    it('should respond with an empty object as ack and send the request validation to the client', async () => {
      const promiseOfRequestValidation = new Promise<RequestValidationMessage>((resolve, _) => {
        desktopClientSocket.on(MessageType.REQUEST_VALIDATION, (data: RequestValidationMessage) => {
          resolve(data)
        })
      })

      await authDappSocket.emitWithAck(MessageType.REQUEST_VALIDATION, {
        requestId: requestResponse.requestId
      })

      return expect(promiseOfRequestValidation).resolves.toEqual({
        requestId: requestResponse.requestId
      })
    })
  })

  describe('and there is no client connected listening for the request validation', () => {
    beforeEach(async () => {
      requestResponse = (await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
        method: METHOD_DCL_PERSONAL_SIGN,
        params: []
      })) as RequestResponseMessage
    })

    it('should respond with an empty object as ack', async () => {
      return expect(
        authDappSocket.emitWithAck(MessageType.REQUEST_VALIDATION, {
          requestId: requestResponse.requestId
        })
      ).resolves.toEqual({})
    })
  })
})
