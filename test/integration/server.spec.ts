import { Socket, io } from 'socket.io-client'
import { test } from '../components'
import { Message, MessageType, RequestType } from '../../src/ports/server/types'
import { TestArguments } from '@well-known-components/test-helpers'
import { BaseComponents } from '../../src/types'
import assert from 'assert'

let socketA: Socket
let socketB: Socket

afterEach(() => {
  socketA.close()
})

async function connectClient(args: TestArguments<BaseComponents>) {
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

async function fetch(sentMessage: Message) {
  return new Promise<Message>(resolve => {
    socketA.on('message', (receivedMessage: Message) => {
      resolve(receivedMessage)
    })

    socketA.emit('message', sentMessage)
  })
}

test('when sending a request type message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response', async () => {
    const message = await fetch({
      type: MessageType.REQUEST,
      payload: {
        foo: 'bar'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.REQUEST_RESPONSE,
      payload: {
        ok: false,
        error: `[{\"instancePath\":\"/payload\",\"schemaPath\":\"#/properties/payload/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"type\"},\"message\":\"must have required property 'type'\"}]`
      }
    })
  })
})

test('when sending a request type message with a valid schema', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with a message containing a request id', async () => {
    const message = await fetch({
      type: MessageType.REQUEST,
      payload: {
        type: RequestType.SIGNATURE,
        data: 'data to sign'
      }
    })

    expect(message).toEqual({
      type: MessageType.REQUEST_RESPONSE,
      payload: {
        ok: true,
        requestId: expect.any(String)
      }
    })
  })
})

test('when sending a recover type message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response', async () => {
    const message = await fetch({
      type: MessageType.RECOVER,
      payload: {
        foo: 'bar'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.RECOVER_RESPONSE,
      payload: {
        ok: false,
        error: `[{\"instancePath\":\"/payload\",\"schemaPath\":\"#/properties/payload/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"requestId\"},\"message\":\"must have required property 'requestId'\"}]`
      }
    })
  })
})

test('when sending a recover type message with an invalid schema but containing a request id', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response with the request id', async () => {
    const message = await fetch({
      type: MessageType.RECOVER,
      payload: {
        requestId: 'foo',
        foo: 'bar'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.RECOVER_RESPONSE,
      payload: {
        ok: false,
        requestId: 'foo',
        error: `[{\"instancePath\":\"/payload\",\"schemaPath\":\"#/properties/payload/additionalProperties\",\"keyword\":\"additionalProperties\",\"params\":{\"additionalProperty\":\"foo\"},\"message\":\"must NOT have additional properties\"}]`
      }
    })
  })
})

test('when sending a recover type message with a valid schema but the request id does not exist', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response', async () => {
    const message = await fetch({
      type: MessageType.RECOVER,
      payload: {
        requestId: 'foo'
      }
    })

    expect(message).toEqual({
      type: MessageType.RECOVER_RESPONSE,
      payload: {
        ok: false,
        requestId: 'foo',
        error: 'Message for request with id "foo" not found'
      }
    })
  })
})

test('when sending a recover type message with an existing request id for a signature request', args => {
  let requestId: string

  beforeEach(async () => {
    await connectClient(args)

    const message = await fetch({
      type: MessageType.REQUEST,
      payload: {
        type: RequestType.SIGNATURE,
        data: 'data to sign'
      }
    })

    assert(message.type === MessageType.REQUEST_RESPONSE)
    assert(message.payload.ok)

    requestId = message.payload.requestId
  })

  it('should respond with a recover response with the request payload data', async () => {
    const message = await fetch({
      type: MessageType.RECOVER,
      payload: {
        requestId
      }
    })

    expect(message).toEqual({
      type: MessageType.RECOVER_RESPONSE,
      payload: {
        ok: true,
        requestId,
        type: RequestType.SIGNATURE,
        data: 'data to sign'
      }
    })
  })
})

test('when sending a submit signature type message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response', async () => {
    const message = await fetch({
      type: MessageType.SUBMIT_SIGNATURE,
      payload: {
        foo: 'bar'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
      payload: {
        ok: false,
        error: `[{\"instancePath\":\"/payload\",\"schemaPath\":\"#/properties/payload/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"requestId\"},\"message\":\"must have required property 'requestId'\"}]`
      }
    })
  })
})

test('when sending a submit signature type message with an invalid schema but containing a request id', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response with the request id', async () => {
    const message = await fetch({
      type: MessageType.SUBMIT_SIGNATURE,
      payload: {
        requestId: 'foo',
        foo: 'bar'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
      payload: {
        ok: false,
        requestId: 'foo',
        error: `[{\"instancePath\":\"/payload\",\"schemaPath\":\"#/properties/payload/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"signer\"},\"message\":\"must have required property 'signer'\"}]`
      }
    })
  })
})

test('when sending a submit signature type message with a valid schema but the request id does not exist', args => {
  beforeEach(async () => {
    await connectClient(args)
  })

  it('should respond with an error response', async () => {
    const message = await fetch({
      type: MessageType.SUBMIT_SIGNATURE,
      payload: {
        requestId: 'foo',
        signer: 'signer',
        signature: 'signature'
      }
    })

    expect(message).toEqual({
      type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
      payload: {
        ok: false,
        requestId: 'foo',
        error: 'Socket Id for request with id "foo" not found'
      }
    })
  })
})

test('when sending a submit signature type message with an existing request id', args => {
  let requestId: string

  beforeEach(async () => {
    await connectClient(args)

    const message = await fetch({
      type: MessageType.REQUEST,
      payload: {
        type: RequestType.SIGNATURE,
        data: 'data to sign'
      }
    })

    assert(message.type === MessageType.REQUEST_RESPONSE)
    assert(message.payload.ok)

    requestId = message.payload.requestId
  })

  it('should respond with a submit signature response with the submit signature message data', async () => {
    const message = await fetch({
      type: MessageType.SUBMIT_SIGNATURE,
      payload: {
        requestId,
        signer: 'signer',
        signature: 'signature'
      }
    })

    expect(message).toEqual({
      type: MessageType.SUBMIT_SIGNATURE_RESPONSE,
      payload: {
        ok: true,
        requestId,
        signer: 'signer',
        signature: 'signature'
      }
    })
  })
})
