import assert from 'assert'
import { TestArguments } from '@well-known-components/test-helpers'
import { Socket, io } from 'socket.io-client'
import { Message, MessageType, RequestType } from '../../src/ports/server/types'
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

async function fetch(sentMessage: Message, sender: Socket = socketA, receiver: Socket = socketA) {
  return new Promise<Message>(resolve => {
    receiver.on('message', (receivedMessage: Message) => {
      resolve(receivedMessage)
    })

    sender.emit('message', sentMessage)
  })
}

test('when sending an object as a message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message containing an error', async () => {
    const message = await fetch({
      foo: 'bar'
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.INVALID_RESPONSE,
      payload: {
        ok: false,
        error:
          '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"}]'
      }
    })
  })
})

test('when sending an object as a message that has an invalid schema but contains a request id', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message containing an error and the request id', async () => {
    const message = await fetch({
      foo: 'bar',
      payload: {
        requestId: 'foo'
      }
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.INVALID_RESPONSE,
      payload: {
        ok: false,
        requestId: 'foo',
        error:
          '[{"instancePath":"","schemaPath":"#/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"}]'
      }
    })
  })
})

test('when sending an object as a message that has a response type', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message containing an error', async () => {
    const message = await fetch({
      type: MessageType.REQUEST_RESPONSE
    } as unknown as Message)

    expect(message).toEqual({
      type: MessageType.INVALID_RESPONSE,
      payload: {
        ok: false,
        error:
          '[{"instancePath":"/type","schemaPath":"#/properties/type/enum","keyword":"enum","params":{"allowedValues":["request","recover","submit-signature"]},"message":"must be equal to one of the allowed values"}]'
      }
    })
  })
})

test('when sending null as a message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message containing an error', async () => {
    const message = await fetch(null as unknown as Message)

    expect(message).toEqual({
      type: MessageType.INVALID_RESPONSE,
      payload: {
        ok: false,
        error: '[{"instancePath":"","schemaPath":"#/type","keyword":"type","params":{"type":"object"},"message":"must be object"}]'
      }
    })
  })
})

test('when sending a string as a message', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message containing an error', async () => {
    const message = await fetch('foo' as unknown as Message)

    expect(message).toEqual({
      type: MessageType.INVALID_RESPONSE,
      payload: {
        ok: false,
        error: '[{"instancePath":"","schemaPath":"#/type","keyword":"type","params":{"type":"object"},"message":"must be object"}]'
      }
    })
  })
})

test('when sending a request message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a request response containing an error', async () => {
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
        error:
          '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"type"},"message":"must have required property \'type\'"}]'
      }
    })
  })
})

test('when sending a request message with a valid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a request response message containing a request id', async () => {
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

test('when sending a recover message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message containing an error', async () => {
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
        error:
          '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
      }
    })
  })
})

test('when sending a recover message with an invalid schema but containing a request id', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message containing an error and the request id', async () => {
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
        error:
          '[{"instancePath":"/payload","schemaPath":"#/properties/payload/additionalProperties","keyword":"additionalProperties","params":{"additionalProperty":"foo"},"message":"must NOT have additional properties"}]'
      }
    })
  })
})

test('when sending a recover message with a valid schema but the request id does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a recover response message containing an error', async () => {
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

test('when sending a recover message with a valid schema and a request id that exists', args => {
  let requestId: string

  beforeEach(async () => {
    await connectClients(args)

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

  it('should respond with a recover response message containing the stored request payload', async () => {
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

test('when sending a submit signature message with an invalid schema', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a submit signature response message containing an error', async () => {
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
        error:
          '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"requestId"},"message":"must have required property \'requestId\'"}]'
      }
    })
  })
})

test('when sending a submit signature message with an invalid schema but containing a request id', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a submit signature response message containing an error and the request id', async () => {
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
        error:
          '[{"instancePath":"/payload","schemaPath":"#/properties/payload/required","keyword":"required","params":{"missingProperty":"signer"},"message":"must have required property \'signer\'"}]'
      }
    })
  })
})

test('when sending a submit signature message with a valid schema but the request id does not exist', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with a submit signature response message containing an error', async () => {
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

test('when sending a submit signature message with a valid schema and a request id that exists', args => {
  let requestId: string

  beforeEach(async () => {
    await connectClients(args)

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

  it('should respond with a submit signature response message with the submit signature payload', async () => {
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

test('when socket B sends the request message and then socket A sends the submit signature message', args => {
  let requestId: string

  beforeEach(async () => {
    await connectClients(args)

    const message = await fetch(
      {
        type: MessageType.REQUEST,
        payload: {
          type: RequestType.SIGNATURE,
          data: 'data to sign'
        }
      },
      socketB,
      socketB
    )

    assert(message.type === MessageType.REQUEST_RESPONSE)
    assert(message.payload.ok)

    requestId = message.payload.requestId
  })

  it('should be socket B that receives the submit signature response message', async () => {
    const message = await fetch(
      {
        type: MessageType.SUBMIT_SIGNATURE,
        payload: {
          requestId,
          signer: 'signer',
          signature: 'signature'
        }
      },
      socketA,
      socketB
    )

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
