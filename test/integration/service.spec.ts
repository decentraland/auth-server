import { TestArguments } from '@well-known-components/test-helpers'
import { Socket, io } from 'socket.io-client'
import { InputMessage, MessageType, ResponseMessage } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test } from '../components'

let socketA: Socket
let socketB: Socket

afterEach(() => {
  socketA.close()
})

async function connectClients(args: TestArguments<BaseComponents>) {
  const port = await args.components.config.getString('HTTP_SERVER_PORT')

  socketA = io(`http://localhost:${port}`)
  socketB = io(`http://localhost:${port}`)

  await new Promise(resolve => {
    let connected = 0

    const handleOnConnect = () => {
      connected++

      if (connected === 2) {
        resolve(undefined)
      }
    }

    socketA.on('connect', handleOnConnect)
    socketB.on('connect', handleOnConnect)
  })
}

async function fetch(msg: InputMessage, sender: Socket = socketA, receiver: Socket = socketA) {
  return new Promise<ResponseMessage>(resolve => {
    receiver.on('message', (response: ResponseMessage) => {
      resolve(response)
    })

    sender.emit('message', msg)
  })
}

test('when sending a message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a message of type invalid, containing the schema error', async () => {
    const message = await fetch({
      foo: 'bar'
    } as unknown as InputMessage)

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId: '',
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf/2/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending a message with an invalid schema, containing a request id', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a message of type invalid, containing the schema error and a request id', async () => {
    const requestId = 'requestId'

    const message = await fetch({
      requestId
    } as unknown as InputMessage)

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error:
        '[{"instancePath":"","schemaPath":"#/oneOf/0/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf/1/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf/2/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"},{"instancePath":"","schemaPath":"#/oneOf","keyword":"oneOf","params":{"passingSchemas":null},"message":"must match exactly one schema in oneOf"}]'
    })
  })
})

test('when sending a request message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a request response message, containing a request id', async () => {
    const message = await fetch({
      type: MessageType.REQUEST,
      method: 'method',
      params: []
    })

    expect(message).toEqual({
      type: MessageType.REQUEST,
      requestId: expect.any(String)
    })
  })
})

test('when sending a recover message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message, containing the request data', async () => {
    const method = 'method'
    const params: string[] = []

    const { requestId } = await fetch({
      type: MessageType.REQUEST,
      method,
      params
    })

    const message = await fetch({
      type: MessageType.RECOVER,
      requestId
    })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId,
      method,
      params
    })
  })
})

test('when sending a recover message, but the request does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message, containing an error message indicating the request does not exist', async () => {
    const requestId = 'requestId'

    const message = await fetch({
      type: MessageType.RECOVER,
      requestId
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" not found`
    })
  })
})

test('when socket B creates a request and socket A sends an outcome message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond to socket B with an outcome response message, containing the same data as the outcome message', async () => {
    const method = 'method'
    const params: string[] = []
    const result = 'result'

    const { requestId } = await fetch(
      {
        type: MessageType.REQUEST,
        method,
        params
      },
      socketB,
      socketB
    )

    const message = await fetch(
      {
        type: MessageType.OUTCOME,
        requestId,
        result
      },
      socketA,
      socketB
    )

    expect(message).toEqual({
      type: MessageType.OUTCOME,
      requestId,
      result
    })
  })
})

test('when socket A sends an outcome message but the request does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond to socket A with an invalid response message, containing an error message indicating the request does not exist', async () => {
    const requestId = 'requestId'

    const message = await fetch({
      type: MessageType.OUTCOME,
      requestId,
      result: 'result'
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" not found`
    })
  })
})

test('when socket A sends the output message but socket B disconnected before it was sent', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond to socket A with an invalid response message, containing an error message indicating socket B is not available', async () => {
    const socketBId = socketB.id

    const { requestId } = await fetch(
      {
        type: MessageType.REQUEST,
        method: 'method',
        params: []
      },
      socketB,
      socketB
    )

    socketB.disconnect()

    const message = await fetch({
      type: MessageType.OUTCOME,
      requestId,
      result: 'result'
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Socket with id "${socketBId}" not found`
    })
  })
})

// test('when sending an object as a message that has an invalid schema but contains a request id', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with an invalid response message containing an error and the request id', async () => {
//     const message = await fetch({
//       foo: 'bar',
//       payload: {
//         requestId: 'foo'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.INVALID_RESPONSE,
//       payload: {
//         ok: false,
//         requestId: 'foo',
//         error:
//           '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"}]'
//       }
//     })
//   })
// })

// test('when sending an object as a message that has a response type', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with an invalid response message containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.REQUEST_RESPONSE
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.INVALID_RESPONSE,
//       payload: {
//         ok: false,
//         error:
//           '[{"instancePath":"/type","schemaPath":"#/properties/type/enum","keyword":"enum","params":{"allowedValues":["request","recover","submit-signature"]},"message":"must be equal to one of the allowed values"}]'
//       }
//     })
//   })
// })

// test('when sending null as a message', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with an invalid response message containing an error', async () => {
//     const message = await fetch(null as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.INVALID_RESPONSE,
//       payload: {
//         ok: false,
//         error: '[{"instancePath":"","schemaPath":"#/type","keyword":"type","params":{"type":"object"},"message":"must be object"}]'
//       }
//     })
//   })
// })

// test('when sending a string as a message', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with an invalid response message containing an error', async () => {
//     const message = await fetch('foo' as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.INVALID_RESPONSE,
//       payload: {
//         ok: false,
//         error: '[{"instancePath":"","schemaPath":"#/type","keyword":"type","params":{"type":"object"},"message":"must be object"}]'
//       }
//     })
//   })
// })

// test('when sending a request message with an invalid schema', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a request response containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.REQUEST,
//       payload: {
//         foo: 'bar'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.REQUEST_RESPONSE,
//       payload: {
//         ok: false,
//         error:
//           '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"}]'
//       }
//     })
//   })
// })

// test('when sending a request message with a valid schema', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a request response message containing a request id', async () => {
//     const message = await fetch({
//       type: MessageType.REQUEST,
//       payload: {
//         type: RequestType.SIGNATURE,
//         data: 'data to sign'
//       }
//     })

//     expect(message).toEqual({
//       type: MessageType.REQUEST_RESPONSE,
//       payload: {
//         ok: true,
//         requestId: expect.any(String)
//       }
//     })
//   })
// })

// test('when sending a recover message with an invalid schema', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a recover response message containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.RECOVER,
//       payload: {
//         foo: 'bar'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.RECOVER_RESPONSE,
//       payload: {
//         ok: false,
//         error:
//           '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
//       }
//     })
//   })
// })

// test('when sending a recover message with an invalid schema but containing a request id', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a recover response message containing an error and the request id', async () => {
//     const message = await fetch({
//       type: MessageType.RECOVER,
//       payload: {
//         requestId: 'foo',
//         foo: 'bar'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.RECOVER_RESPONSE,
//       payload: {
//         ok: false,
//         requestId: 'foo',
//         error:
//           '[{"instancePath":"/payload","schemaPath":"#/properties/payload/additionalProperties","keyword":"additionalProperties","params":{"additionalProperty":"foo"},"message":"must NOT have additional properties"}]'
//       }
//     })
//   })
// })

// test('when sending a recover message with a valid schema but the request id does not exist', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a recover response message containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.RECOVER,
//       payload: {
//         requestId: 'foo'
//       }
//     })

//     expect(message).toEqual({
//       type: MessageType.RECOVER_RESPONSE,
//       payload: {
//         ok: false,
//         requestId: 'foo',
//         error: 'Message for request with id "foo" not found'
//       }
//     })
//   })
// })

// test('when sending a recover message with a valid schema and a request id that exists', args => {
//   let requestId: string

//   beforeEach(async () => {
//     await connectClients(args)

//     const message = await fetch({
//       type: MessageType.REQUEST,
//       payload: {
//         type: RequestType.SIGNATURE,
//         data: 'data to sign'
//       }
//     })

//     assert(message.type === MessageType.REQUEST_RESPONSE)
//     assert(message.payload.ok)

//     requestId = message.payload.requestId
//   })

//   it('should respond with a recover response message containing the stored request payload', async () => {
//     const message = await fetch({
//       type: MessageType.RECOVER,
//       payload: {
//         requestId
//       }
//     })

//     expect(message).toEqual({
//       type: MessageType.RECOVER_RESPONSE,
//       payload: {
//         ok: true,
//         requestId,
//         type: RequestType.SIGNATURE,
//         data: 'data to sign'
//       }
//     })
//   })
// })

// test('when sending a submit signature message with an invalid schema', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a submit signature response message containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.SUBMIT_SIGNATURE,
//       payload: {
//         foo: 'bar'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
//       payload: {
//         ok: false,
//         error:
//           '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
//       }
//     })
//   })
// })

// test('when sending a submit signature message with an invalid schema but containing a request id', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a submit signature response message containing an error and the request id', async () => {
//     const message = await fetch({
//       type: MessageType.SUBMIT_SIGNATURE,
//       payload: {
//         requestId: 'foo',
//         foo: 'bar'
//       }
//     } as unknown as InputMessage)

//     expect(message).toEqual({
//       type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
//       payload: {
//         ok: false,
//         requestId: 'foo',
//         error:
//           '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"signer"},"message":"must have required property \'signer\'"}]'
//       }
//     })
//   })
// })

// test('when sending a submit signature message with a valid schema but the request id does not exist', args => {
//   beforeEach(async () => {
//     await connectClients(args)
//   })

//   it('should respond with a submit signature response message containing an error', async () => {
//     const message = await fetch({
//       type: MessageType.SUBMIT_SIGNATURE,
//       payload: {
//         requestId: 'foo',
//         signer: 'signer',
//         signature: 'signature'
//       }
//     })

//     expect(message).toEqual({
//       type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
//       payload: {
//         ok: false,
//         requestId: 'foo',
//         error: 'Socket Id for request with id "foo" not found'
//       }
//     })
//   })
// })

// test('when sending a submit signature message with a valid schema and a request id that exists', args => {
//   let requestId: string

//   beforeEach(async () => {
//     await connectClients(args)

//     const message = await fetch({
//       type: MessageType.REQUEST,
//       payload: {
//         type: RequestType.SIGNATURE,
//         data: 'data to sign'
//       }
//     })

//     assert(message.type === MessageType.REQUEST_RESPONSE)
//     assert(message.payload.ok)

//     requestId = message.payload.requestId
//   })

//   it('should respond with a submit signature response message with the submit signature payload', async () => {
//     const message = await fetch({
//       type: MessageType.SUBMIT_SIGNATURE,
//       payload: {
//         requestId,
//         signer: 'signer',
//         signature: 'signature'
//       }
//     })

//     expect(message).toEqual({
//       type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
//       payload: {
//         ok: true,
//         requestId,
//         signer: 'signer',
//         signature: 'signature'
//       }
//     })
//   })
// })

// test('when socket B sends the request message and then socket A sends the submit signature message', args => {
//   let requestId: string

//   beforeEach(async () => {
//     await connectClients(args)

//     const message = await fetch(
//       {
//         type: MessageType.REQUEST,
//         payload: {
//           type: RequestType.SIGNATURE,
//           data: 'data to sign'
//         }
//       },
//       socketB,
//       socketB
//     )

//     assert(message.type === MessageType.REQUEST_RESPONSE)
//     assert(message.payload.ok)

//     requestId = message.payload.requestId
//   })

//   it('should be socket B that receives the submit signature response message', async () => {
//     const message = await fetch(
//       {
//         type: MessageType.SUBMIT_SIGNATURE,
//         payload: {
//           requestId,
//           signer: 'signer',
//           signature: 'signature'
//         }
//       },
//       socketA,
//       socketB
//     )

//     expect(message).toEqual({
//       type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
//       payload: {
//         ok: true,
//         requestId,
//         signer: 'signer',
//         signature: 'signature'
//       }
//     })
//   })
// })
