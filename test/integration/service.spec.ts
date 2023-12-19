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
