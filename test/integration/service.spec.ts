import { TestArguments } from '@well-known-components/test-helpers'
import { Socket, io } from 'socket.io-client'
import { InputMessage, MessageType, RequestMessage, ResponseMessage } from '../../src/ports/server/types'
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
      expiration: expect.any(String),
      method,
      params
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
      chainId
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

testWithOverrides({ requestExpirationInSeconds: -1 })('when sending a recover message, but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message, containing an error message indicating the request has expired', async () => {
    const { requestId } = await fetch({
      type: MessageType.REQUEST,
      method: 'method',
      params: []
    })

    const message = await fetch({
      type: MessageType.RECOVER,
      requestId
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" has expired`
    })
  })
})

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
      params: request.params
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
      params: request.params
    })
  })

  it('should respond with a recover response message with the request data of the second request', async () => {
    const message = await fetch({ type: MessageType.RECOVER, requestId: requestId2 })

    expect(message).toEqual({
      type: MessageType.RECOVER,
      requestId: requestId2,
      expiration: expect.any(String),
      method: request.method,
      params: request.params
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
    const sender = 'sender'
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
        sender,
        result
      },
      socketA,
      socketB
    )

    expect(message).toEqual({
      type: MessageType.OUTCOME,
      requestId,
      sender,
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
      sender: 'sender',
      result: 'result'
    })

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Socket with id "${socketBId}" not found`
    })
  })
})

testWithOverrides({ requestExpirationInSeconds: 0.2 })('when socket A sends the output message but the request has expired', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond to socket A with an invalid response message, containing an error message indicating the request has expired', async () => {
    const { requestId } = await fetch(
      {
        type: MessageType.REQUEST,
        method: 'method',
        params: []
      },
      socketB,
      socketB
    )

    await new Promise(resolve => setTimeout(resolve, 200))

    const message = await fetch(
      {
        type: MessageType.OUTCOME,
        requestId,
        sender: 'sender',
        result: 'result'
      },
      socketA,
      socketA
    )

    expect(message).toEqual({
      type: MessageType.INVALID,
      requestId,
      error: `Request with id "${requestId}" has expired`
    })
  })
})
