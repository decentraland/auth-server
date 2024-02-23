import { TestArguments } from '@well-known-components/test-helpers'
import { ethers } from 'ethers'
import { Socket, io } from 'socket.io-client'
import { AuthChain, Authenticator, AuthLinkType } from '@dcl/crypto'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { MessageType } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'

let desktopClientSocket: HttpPollingClient
let authDappSocket: Socket

type HttpPollingClient = {
  request(data: unknown): Promise<any>
  poll(requestId: string): Promise<any>
  cancel(): void
}

function createHttpPollingClient(url: string): HttpPollingClient {
  let shouldPoll = true

  return {
    async request(data: unknown) {
      // Make a post request
      const response = await fetch(`${url}/requests`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: [['Content-Type', 'application/json']]
      })

      return response.json()
    },
    async poll(requestId: string) {
      while (shouldPoll) {
        const response = await fetch(`${url}/requests/${requestId}`)
        if (response.status === 204) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }

        return response.json()
      }
    },
    cancel() {
      shouldPoll = false
    }
  }
}

afterEach(() => {
  desktopClientSocket.cancel()
  authDappSocket.close()
})

async function connectClients(args: TestArguments<BaseComponents>) {
  const port = await args.components.config.getString('HTTP_SERVER_PORT')

  desktopClientSocket = createHttpPollingClient(`http://localhost:${port}`)
  authDappSocket = io(`http://localhost:${port}`)

  await new Promise(resolve => {
    const handleOnConnect = () => {
      resolve(undefined)
    }

    authDappSocket.on('connect', handleOnConnect)
  })
}

test('when sending a request message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const response = await desktopClientSocket.request({})

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
    const response = await desktopClientSocket.request({
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
      const response = await desktopClientSocket.request({
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
      const requestResponse = await desktopClientSocket.request({
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
      const requestResponse = await desktopClientSocket.request({
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
        const requestResponse = await desktopClientSocket.request({
          method: 'method',
          params: [],
          authChain
        })

        expect(requestResponse.error).toEqual(
          `ERROR. Link type: ECDSA_EPHEMERAL. Invalid signer address. Expected: ${otherAccount.address.toLowerCase()}. Actual: ${mainAccount.address.toLowerCase()}.`
        )
      })
    })

    describe('when the auth chain does not have a parseable payload in the second link', () => {
      beforeEach(() => {
        authChain[1].payload = 'unparseable'
      })

      it('should respond with an invalid response message, indicating that the final authority could not be obtained', async () => {
        const requestResponse = await desktopClientSocket.request({
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

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.request({
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

test('when sending a recover message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message', async () => {
    const requestResponse = await desktopClientSocket.request({
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

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.request({
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

test('when the auth dapp sends an outcome message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an empty object as ack', async () => {
    const requestResponse = await desktopClientSocket.request({
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
    const requestResponse = await desktopClientSocket.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      desktopClientSocket.poll(requestResponse.requestId).then(msg => {
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
    const requestResponse = await desktopClientSocket.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      desktopClientSocket.poll(requestResponse.requestId).then(msg => {
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
    const requestResponse = await desktopClientSocket.request({
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
