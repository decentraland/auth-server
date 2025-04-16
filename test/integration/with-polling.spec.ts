import { TestArguments } from '@well-known-components/test-helpers'
import { ethers } from 'ethers'
import { Socket, io } from 'socket.io-client'
import { AuthChain, Authenticator, AuthLinkType } from '@dcl/crypto'
import { METHOD_DCL_PERSONAL_SIGN } from '../../src/ports/server/constants'
import { OutcomeResponseMessage, RecoverResponseMessage, RequestResponseMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'

let desktopHTTPClient: HttpPollingClient
let authDappSocket: Socket

type HttpPollingClient = {
  request(data: unknown): Promise<RequestResponseMessage | { error: string }>
  sendSuccessfulOutcome(requestId: string, sender: string, result: unknown): Promise<{ error: string } | undefined>
  sendFailedOutcome(requestId: string, sender: string, error: { code: number; message: string }): Promise<{ error: string } | undefined>
  getOutcome(requestId: string): Promise<OutcomeResponseMessage | undefined>
  recover(requestId: string): Promise<RecoverResponseMessage>
}

function createHttpClient(url: string): HttpPollingClient {
  return {
    async request(data: unknown): Promise<RequestResponseMessage | { error: string }> {
      // Make a post request
      const response = await fetch(`${url}/requests`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: [
          ['Content-Type', 'application/json'],
          ['Origin', 'http://localhost:3000']
        ]
      })

      return response.json()
    },
    async sendSuccessfulOutcome(requestId: string, sender: string, result: unknown): Promise<{ error: string } | undefined> {
      const response = await fetch(`${url}/v2/outcomes/${requestId}`, {
        method: 'POST',
        body: JSON.stringify({ sender, result }),
        headers: [['Content-Type', 'application/json']]
      })
      let body: { error: string } | undefined

      try {
        body = await response.json()
      } catch (e) {
        return undefined
      }

      return body
    },
    async sendFailedOutcome(
      requestId: string,
      sender: string,
      error: { code: number; message: string }
    ): Promise<{ error: string } | undefined> {
      const response = await fetch(`${url}/v2/outcomes/${requestId}`, {
        method: 'POST',
        body: JSON.stringify({ sender, error }),
        headers: [['Content-Type', 'application/json']]
      })
      let body: { error: string } | undefined

      try {
        body = await response.json()
      } catch (e) {
        return undefined
      }

      return body
    },
    async recover(requestId: string): Promise<RecoverResponseMessage> {
      const response = await fetch(`${url}/v2/requests/${requestId}`, {
        method: 'GET',
        headers: [['Origin', 'http://localhost:3000']]
      })

      return response.json()
    },
    async getOutcome(requestId: string): Promise<OutcomeResponseMessage | undefined> {
      const response = await fetch(`${url}/requests/${requestId}`, {
        method: 'GET',
        headers: [['Origin', 'http://localhost:3000']]
      })

      if (response.status === 204) {
        return undefined
      }

      return response.json()
    }
  }
}

afterEach(() => {
  authDappSocket.close()
})

async function connectClients(args: TestArguments<BaseComponents>) {
  const port = await args.components.config.getString('HTTP_SERVER_PORT')

  desktopHTTPClient = createHttpClient(`http://localhost:${port}`)
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
    const response = await desktopHTTPClient.request({})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"method"},"message":"must have required property \'method\'"}]'
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

  describe('and an auth chain is not provided', () => {
    it('should respond with an invalid response message indicating that the auth chain is required', async () => {
      const response = await desktopHTTPClient.request({
        method: 'method',
        params: []
      })

      expect(response).toEqual({
        error: 'Auth chain is required'
      })
    })
  })

  describe('and an auth chain is provided', () => {
    it('should respond with the data of the request', async () => {
      const requestResponse = await desktopHTTPClient.request({
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
      const requestResponse = (await desktopHTTPClient.request({
        method: 'method',
        params: [],
        authChain
      })) as RequestResponseMessage

      const recoverResponse = await desktopHTTPClient.recover(requestResponse.requestId)

      expect(recoverResponse.sender).toEqual(mainAccount.address.toLowerCase())
    })

    describe('and the payload on the signer link does not match the address of the ephemeral message signer', () => {
      let otherAccount: ethers.HDNodeWallet

      beforeEach(() => {
        otherAccount = ethers.Wallet.createRandom()

        authChain[0].payload = otherAccount.address
      })

      it('should respond with an invalid response message, indicating that the expected signer address is different', async () => {
        const requestResponse = (await desktopHTTPClient.request({
          method: 'method',
          params: [],
          authChain
        })) as { error: string }

        expect(requestResponse.error).toEqual(
          `ERROR. Link type: ECDSA_EPHEMERAL. Invalid signer address. Expected: ${otherAccount.address.toLowerCase()}. Actual: ${mainAccount.address.toLowerCase()}.`
        )
      })
    })

    describe('and the auth chain does not have a parsable payload in the second link', () => {
      beforeEach(() => {
        authChain[1].payload = 'unparsable'
      })

      it('should respond with an invalid response message, indicating that the final authority could not be obtained', async () => {
        const requestResponse = (await desktopHTTPClient.request({
          method: 'method',
          params: [],
          authChain
        })) as { error: string }

        expect(requestResponse.error).toEqual('Could not get final authority from auth chain')
      })
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const recoverResponse = await desktopHTTPClient.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a recover message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with the recover data of the request', async () => {
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const recoverResponse = await desktopHTTPClient.recover(requestResponse.requestId)

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
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const response = await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', undefined)

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
    const response = await desktopHTTPClient.sendSuccessfulOutcome('requestId', 'sender', 'result')

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
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const outcomeResponse = await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a valid outcome message with the HTTP endpoints', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with the outcome response message', async () => {
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', 'result')

    const outcomeResponse = await desktopHTTPClient.getOutcome(requestResponse.requestId)

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })
  })

  it('should send the outcome response message to a websocket connected client when the outcome is sent via the HTTP', async () => {
    const requestResponse = (await authDappSocket.emitWithAck('request', {
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const promiseOfAnOutcome = new Promise<OutcomeResponseMessage>((resolve, _) => {
      authDappSocket.on('outcome', (data: OutcomeResponseMessage) => {
        resolve(data)
      })
    })

    await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', 'result')

    return expect(promiseOfAnOutcome).resolves.toEqual({
      requestId: requestResponse.requestId,
      sender: 'sender',
      result: 'result'
    })
  })

  it('should respond with the outcome response message with an error', async () => {
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await desktopHTTPClient.sendFailedOutcome(requestResponse.requestId, 'sender', {
      code: 1233,
      message: 'anErrorOccurred'
    })

    const outcomeResponse = await desktopHTTPClient.getOutcome(requestResponse.requestId)

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender: 'sender',
      error: {
        code: 1233,
        message: 'anErrorOccurred'
      }
    })
  })

  it('should respond with an invalid response message if calling the output twice', async () => {
    const requestResponse = (await desktopHTTPClient.request({
      method: METHOD_DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', 'result')

    const outcomeResponse = await desktopHTTPClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" already has a response`
    })
  })
})
