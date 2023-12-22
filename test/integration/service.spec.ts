import { TestArguments } from '@well-known-components/test-helpers'
import { Socket, io } from 'socket.io-client'
import { MessageType } from '../../src/ports/server/types'
import { BaseComponents } from '../../src/types'
import { test, testWithOverrides } from '../components'

let desktopClientSocket: Socket
let authDappSocket: Socket

afterEach(() => {
  desktopClientSocket.close()
  authDappSocket.close()
})

async function connectClients(args: TestArguments<BaseComponents>) {
  const port = await args.components.config.getString('HTTP_SERVER_PORT')

  desktopClientSocket = io(`http://localhost:${port}`)
  authDappSocket = io(`http://localhost:${port}`)

  await new Promise(resolve => {
    let connected = 0

    const handleOnConnect = () => {
      connected++

      if (connected === 2) {
        resolve(undefined)
      }
    }

    desktopClientSocket.on('connect', handleOnConnect)
    authDappSocket.on('connect', handleOnConnect)
  })
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
      method: 'method',
      params: []
    })

    expect(response).toEqual({
      requestId: expect.any(String),
      expiration: expect.any(String),
      code: expect.any(Number)
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
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
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

test('when sending a recover message for a request that has been overriden by another one', args => {
  beforeEach(async () => {
    await connectClients(args)
  })

  it('should respond with an invalid response message', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: []
    })

    await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
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
      method: 'method',
      params: []
    })

    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: []
    })
  })

  it('should not override the first request if it was sent by a different socket', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: []
    })

    await authDappSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
      params: []
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
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
      method: 'method',
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
      method: 'method',
      params: [],
      sender: 'sender',
      chainId: 1
    })

    const recoverResponse = await authDappSocket.emitWithAck(MessageType.RECOVER, {
      requestId: requestResponse.requestId
    })

    expect(recoverResponse).toEqual({
      expiration: requestResponse.expiration,
      code: requestResponse.code,
      method: 'method',
      params: [],
      sender: 'sender',
      chainId: 1
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
      error: `[{\"instancePath\":\"\",\"schemaPath\":\"#/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"requestId\"},\"message\":\"must have required property 'requestId'\"}]`
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
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
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
      method: 'method',
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
      method: 'method',
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
      method: 'method',
      params: []
    })

    const outcomeResponsePromise = new Promise(resolve => {
      desktopClientSocket.on(MessageType.OUTCOME, msg => {
        resolve(msg)
      })
    })

    authDappSocket.emitWithAck(MessageType.OUTCOME, {
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

  it('should respond with an invalid response message if calling the output twice', async () => {
    const requestResponse = await desktopClientSocket.emitWithAck(MessageType.REQUEST, {
      method: 'method',
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
