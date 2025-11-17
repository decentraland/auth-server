import { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { Socket } from 'socket.io-client'
import { AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'
import { MessageType, Method, OutcomeResponseMessage, RequestResponseMessage, RequestValidationMessage } from '../../src/ports/server/types'
import { test, testWithOverrides } from '../components'
import { createHttpClient, createAuthWsClient, HttpPollingClient } from '../utils'
import { createTestIdentity, generateRandomIdentityId } from '../utils/test-identity'

let httpClient: HttpPollingClient
let wsClient: Socket<DefaultEventsMap, DefaultEventsMap>

afterEach(() => {
  if (wsClient && wsClient.connected) {
    wsClient.close()
  }
})

test('when sending a request message with an invalid schema', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with an invalid response message', async () => {
    const response = await httpClient.request({})

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"method"},"message":"must have required property \'method\'"}]'
    })
  })
})

test(`when sending a request message for a method that is not ${Method.DCL_PERSONAL_SIGN}`, args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    wsClient = await createAuthWsClient(port)
    httpClient = await createHttpClient(port)
  })

  describe('and an auth chain is not provided', () => {
    it('should respond with an invalid response message indicating that the auth chain is required', async () => {
      const response = await httpClient.request({
        method: 'method',
        params: []
      })

      expect(response).toEqual({
        error: 'Auth chain is required'
      })
    })
  })

  describe('and an auth chain is provided', () => {
    let testIdentity: AuthIdentity

    beforeEach(async () => {
      testIdentity = await createTestIdentity()
    })

    it('should respond with the data of the request', async () => {
      const requestResponse = await httpClient.request({
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
      const requestResponse = (await httpClient.request({
        method: 'method',
        params: [],
        authChain: testIdentity.authChain
      })) as RequestResponseMessage

      const recoverResponse = await httpClient.recover(requestResponse.requestId)

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
        const requestResponse = (await httpClient.request({
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })) as { error: string }

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
        const requestResponse = (await httpClient.request({
          method: 'method',
          params: [],
          authChain: modifiedAuthChain
        })) as { error: string }

        expect(requestResponse.error).toEqual('Could not get final authority from auth chain')
      })
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending a recover message but the request has expired', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const recoverResponse = await httpClient.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a recover message', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with the recover data of the request', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const recoverResponse = await httpClient.recover(requestResponse.requestId)

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })
  })
})

test('when sending an outcome message with an invalid schema', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const response = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, 'sender', undefined)

    expect(response).toEqual({
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"result"},"message":"must have required property \'result\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"error"},"message":"must have required property \'error\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending an outcome message but the request does not exist', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with an invalid response message', async () => {
    const requestId = generateRandomIdentityId()
    const sender = createUnsafeIdentity().address

    const response = await httpClient.sendSuccessfulOutcome(requestId, sender, 'result')

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })('when sending an outcome message but the request has expired', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const sender = createUnsafeIdentity().address
    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" has expired`
    })
  })
})

test('when sending a valid outcome message with the HTTP endpoints', args => {
  let sender: string

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    wsClient = await createAuthWsClient(port)
    sender = createUnsafeIdentity().address
  })

  it('should respond with the outcome response message', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    const outcomeResponse = await httpClient.getOutcome(requestResponse.requestId)

    expect(outcomeResponse).toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should send the outcome response message to a websocket connected client when the outcome is sent via the HTTP', async () => {
    const requestResponse = (await wsClient.emitWithAck('request', {
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    const promiseOfAnOutcome = new Promise<OutcomeResponseMessage>((resolve, _) => {
      wsClient.on(MessageType.OUTCOME, (data: OutcomeResponseMessage) => {
        resolve(data)
      })
    })

    await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    return expect(promiseOfAnOutcome).resolves.toEqual({
      requestId: requestResponse.requestId,
      sender,
      result: 'result'
    })
  })

  it('should respond with the outcome response message with an error', async () => {
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await httpClient.sendFailedOutcome(requestResponse.requestId, sender, {
      code: 1233,
      message: 'anErrorOccurred'
    })

    const outcomeResponse = await httpClient.getOutcome(requestResponse.requestId)

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
    const requestResponse = (await httpClient.request({
      method: Method.DCL_PERSONAL_SIGN,
      params: []
    })) as RequestResponseMessage

    await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    const outcomeResponse = await httpClient.sendSuccessfulOutcome(requestResponse.requestId, sender, 'result')

    expect(outcomeResponse).toEqual({
      error: `Request with id "${requestResponse.requestId}" already has a response`
    })
  })
})

testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })(
  'when posting that a request needs validation but the request has expired',
  args => {
    beforeEach(async () => {
      const port = await args.components.config.requireString('HTTP_SERVER_PORT')
      httpClient = await createHttpClient(port)
    })

    it('should respond with a 410 and an expired response message', async () => {
      const requestResponse = (await httpClient.request({
        method: Method.DCL_PERSONAL_SIGN,
        params: []
      })) as RequestResponseMessage

      const response = await httpClient.notifyRequestValidation(requestResponse.requestId)

      expect(response).toEqual({
        error: `Request with id "${requestResponse.requestId}" has expired`
      })
    })
  }
)

test('when posting that a request needs validation but the request does not exist', args => {
  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
  })

  it('should respond with a 404 and a not found response message', async () => {
    const requestId = generateRandomIdentityId()
    const response = await httpClient.notifyRequestValidation(requestId)

    expect(response).toEqual({
      error: `Request with id "${requestId}" not found`
    })
  })
})

test('when posting that a request needs validation and the request is valid', args => {
  let requestResponse: RequestResponseMessage

  beforeEach(async () => {
    const port = await args.components.config.requireString('HTTP_SERVER_PORT')
    httpClient = await createHttpClient(port)
    wsClient = await createAuthWsClient(port)
  })

  describe('and there is a client connected listening for the request validation', () => {
    beforeEach(async () => {
      requestResponse = (await wsClient.emitWithAck('request', {
        method: Method.DCL_PERSONAL_SIGN,
        params: []
      })) as RequestResponseMessage
    })

    it('should respond with a 204 and a valid response message and send the request validation to the client', async () => {
      const promiseOfRequestValidation = new Promise<RequestValidationMessage>((resolve, _) => {
        wsClient.on(MessageType.REQUEST_VALIDATION_STATUS, (data: RequestValidationMessage) => {
          resolve(data)
        })
      })

      await httpClient.notifyRequestValidation(requestResponse.requestId)

      return expect(promiseOfRequestValidation).resolves.toEqual({
        requestId: requestResponse.requestId
      })
    })
  })

  describe('and there is no client connected listening for the request validation', () => {
    beforeEach(async () => {
      requestResponse = (await httpClient.request({
        method: Method.DCL_PERSONAL_SIGN,
        params: []
      })) as RequestResponseMessage
    })

    it('should respond with a 204 and a valid response message', async () => {
      return expect(httpClient.notifyRequestValidation(requestResponse.requestId)).resolves.toBeUndefined()
    })
  })
})

// test('when getting the request validation status of a request that does not exist', args => {
//   beforeEach(async () => {
//     const port = await args.components.config.requireString('HTTP_SERVER_PORT')
//     httpClient = await createHttpClient(port)
//   })

//   it('should respond with a 404 and an error message', async () => {
//     const response = await httpClient.getRequestValidationStatus('requestId')

//     expect(response).toEqual({
//       error: 'Request with id "requestId" not found'
//     })
//   })
// })

// testWithOverrides({ dclPersonalSignExpirationInSeconds: -1 })(
//   'when getting the request validation status of a request that has expired',
//   args => {
//     let requestResponse: RequestResponseMessage

//     beforeEach(async () => {
//       const port = await args.components.config.requireString('HTTP_SERVER_PORT')
//       httpClient = await createHttpClient(port)
//       requestResponse = (await httpClient.request({
//         method: Method.DCL_PERSONAL_SIGN,
//         params: []
//       })) as RequestResponseMessage
//     })

//     it('should respond with a 410 and an expired response message', async () => {
//       const response = await httpClient.getRequestValidationStatus(requestResponse.requestId)

//       expect(response).toEqual({
//         error: 'Request with id "requestId" has expired'
//       })
//     })
//   }
// )

// test('when getting the request validation status of a request that should not be validated', args => {
//   let requestResponse: RequestResponseMessage

//   beforeEach(async () => {
//     const port = await args.components.config.requireString('HTTP_SERVER_PORT')
//     httpClient = await createHttpClient(port)
//     requestResponse = (await httpClient.request({
//       method: Method.DCL_PERSONAL_SIGN,
//       params: []
//     })) as RequestResponseMessage
//   })

//   it('should respond with a 200 and the request validation status as false', async () => {
//     const response = await httpClient.getRequestValidationStatus(requestResponse.requestId)

//     expect(response).toEqual({
//       requestId: requestResponse.requestId,
//       requiresValidation: false
//     })
//   })
// })

// test('when getting the request validation status of a request that should be validated', args => {
//   let requestResponse: RequestResponseMessage

//   beforeEach(async () => {
//     const port = await args.components.config.requireString('HTTP_SERVER_PORT')
//     httpClient = await createHttpClient(port)
//     requestResponse = (await httpClient.request({
//       method: Method.DCL_PERSONAL_SIGN,
//       params: []
//     })) as RequestResponseMessage

//     await httpClient.notifyRequestValidation(requestResponse.requestId)
//   })

//   it('should respond with a 200 and the request validation status as true', async () => {
//     const response = await httpClient.getRequestValidationStatus(requestResponse.requestId)

//     expect(response).toEqual({
//       requestId: requestResponse.requestId,
//       requiresValidation: true
//     })
//   })
// })
