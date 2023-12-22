import { TestArguments } from '@well-known-components/test-helpers'
import { Socket, io } from 'socket.io-client'
import {
  InputMessage,
  MessageType,
  OutcomeMessage,
  RecoverMessage,
  RequestMessage,
  RequestResponseMessage,
  ResponseMessage
} from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'

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

  it('should respond with a request response message, containing a request id and the expiration', async () => {
    const message = await fetch({
      type: MessageType.REQUEST,
      method: 'method',
      params: []
    })

    expect(message).toEqual({
      type: MessageType.REQUEST,
      requestId: expect.any(String),
      expiration: expect.any(String),
      code: expect.any(Number)
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
      expiration: expect.any(String),
      method,
      params,
      code: expect.any(Number)
    })
  })

  it('should respond with a recover response message, containing the same code as the one provided by the request response message', async () => {
    const method = 'method'
    const params: string[] = []

    const { requestId, code } = (await fetch({
      type: MessageType.REQUEST,
      method,
      params
    })) as RequestResponseMessage

    const message = await fetch({
      type: MessageType.RECOVER,
      requestId
    })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId,
      expiration: expect.any(String),
      method,
      params,
      code
    })
  })
})

test('when sending a recover message, after a request that contained sender and chain id', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message, containing the request data, including the sender and chain id', async () => {
    const method = 'method'
    const params: string[] = []
    const sender = 'sender'
    const chainId = 1

    const { requestId } = await fetch({
      type: MessageType.REQUEST,
      method,
      params,
      sender,
      chainId
    })

    const message = await fetch({
      type: MessageType.RECOVER,
      requestId
    })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId,
      expiration: expect.any(String),
      method,
      params,
      sender,
      chainId,
      code: expect.any(Number)
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

testWithOverrides({ requestExpirationInSeconds: -1 /** The request is created as expired */ })(
  'when sending a recover message, but the request has expired',
  args => {
    let requestId: string
    let recoverMessage: RecoverMessage

    beforeEach(async () => {
      await connectClients(args)

      const request = await fetch({
        type: MessageType.REQUEST,
        method: 'method',
        params: []
      })

      requestId = request.requestId

      recoverMessage = {
        type: MessageType.RECOVER,
        requestId
      }
    })

    it('should respond with an invalid response message, containing an error message indicating the request has expired on the first recover message', async () => {
      const message = await fetch(recoverMessage)

      expect(message).toEqual({
        type: MessageType.INVALID,
        requestId,
        error: `Request with id "${requestId}" has expired`
      })
    })

    it('should respond with an invalid response message, containing an error message indicating the request does not exist on the second message', async () => {
      await fetch(recoverMessage)
      const message = await fetch(recoverMessage)

      expect(message).toEqual({
        type: MessageType.INVALID,
        requestId,
        error: `Request with id "${requestId}" not found`
      })
    })
  }
)

test('when sending 2 request messages with a single socket, and sending a recover messages for them afterwards', args => {
  let request: RequestMessage
  let requestId1: string
  let requestId2: string

  beforeEach(async () => {
    await connectClients(args)

    request = {
      type: MessageType.REQUEST,
      method: 'method',
      params: []
    }

    const request1 = await fetch(request)
    const request2 = await fetch(request)

    requestId1 = request1.requestId
    requestId2 = request2.requestId
  })

  it('should respond with an invalid response message indicating that the first request does not exist', async () => {
    const message = await fetch({ type: MessageType.RECOVER, requestId: requestId1 })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId: requestId1,
      error: `Request with id "${requestId1}" not found`
    })
  })

  it('should respond with a recover response message with the request data of the second request', async () => {
    const message = await fetch({ type: MessageType.RECOVER, requestId: requestId2 })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId: requestId2,
      expiration: expect.any(String),
      method: request.method,
      params: request.params,
      code: expect.any(Number)
    })
  })
})

test('when sending 2 request messages with different sockets, and sending a recover messages for them afterwards', args => {
  let request: RequestMessage
  let requestId1: string
  let requestId2: string

  beforeEach(async () => {
    await connectClients(args)

    request = {
      type: MessageType.REQUEST,
      method: 'method',
      params: []
    }

    const request1 = await fetch(request, socketA, socketA)
    const request2 = await fetch(request, socketB, socketB)

    requestId1 = request1.requestId
    requestId2 = request2.requestId
  })

  it('should respond with a recover response message with the request data of the first request', async () => {
    const message = await fetch({ type: MessageType.RECOVER, requestId: requestId1 })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId: requestId1,
      expiration: expect.any(String),
      method: request.method,
      params: request.params,
      code: expect.any(Number)
    })
  })

  it('should respond with a recover response message with the request data of the second request', async () => {
    const message = await fetch({ type: MessageType.RECOVER, requestId: requestId2 })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId: requestId2,
      expiration: expect.any(String),
      method: request.method,
      params: request.params,
      code: expect.any(Number)
    })
  })
})

test('when socket B creates a request and socket A sends an outcome message', args => {
  let sender: string
  let result: string
  let requestId: string
  let messagefoo: InputMessage

  beforeEach(async () => {
    await connectClients(args)

    sender = 'sender'
    result = 'result'

    const request = await fetch(
      {
        type: MessageType.REQUEST,
        method: 'method',
        params: []
      },
      socketB,
      socketB
    )

    requestId = request.requestId

    messagefoo = {
      type: MessageType.OUTCOME,
      requestId,
      sender,
      result
    }
  })

  it('should respond to socket B with an outcome response message, containing the same data as the outcome message', async () => {
    const message = await fetch(messagefoo, socketA, socketB)

    expect(message).toEqual({
      type: MessageType.OUTCOME,
      requestId,
      sender,
      result
    })
  })

  it('should respond to socket A with an outcome response message for input', async () => {
    const message = await fetch(messagefoo, socketA, socketA)

    expect(message).toEqual({
      type: MessageType.OUTCOME,
      requestId
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
      sender: 'sender',
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

  it('should respond to socket A with an invalid response message, containing an error message indicating that the request is not available anymore as it was deleted', async () => {
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
      sender: 'sender',
      result: 'result'
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" not found`
    })
  })
})

testWithOverrides({
  requestExpirationInSeconds: 0.2 /** The request expires with enough time for the test to wait for it without affecting dev experience */
})('when socket A sends the output message but the request has expired', args => {
  let requestId: string
  let outcomeMessage: OutcomeMessage

  beforeEach(async () => {
    await connectClients(args)

    const request = await fetch(
      {
        type: MessageType.REQUEST,
        method: 'method',
        params: []
      },
      socketB,
      socketB
    )

    requestId = request.requestId

    outcomeMessage = {
      type: MessageType.OUTCOME,
      requestId,
      sender: 'sender',
      result: 'result'
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  })

  it('should respond to socket A with an invalid response message, containing an error message indicating the request has expired on the first message', async () => {
    await new Promise(resolve => setTimeout(resolve, 200))

    const message = await fetch(outcomeMessage, socketA, socketA)

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" has expired`
    })
  })

  it('should respond to socket A with an invalid response message, containing an error message indicating the request cannot be found on the second message', async () => {
    await new Promise(resolve => setTimeout(resolve, 200))

    await fetch(outcomeMessage, socketA, socketA)

    const message = await fetch(outcomeMessage, socketA, socketA)

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" not found`
    })
  })
})
