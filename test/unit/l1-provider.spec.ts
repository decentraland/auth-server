import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { AddressInfo } from 'net'
import { AuthIdentity } from '@dcl/crypto'
import { createL1Provider } from '../../src/adapters/l1-provider'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { asContractAccountChain } from '../utils/l1-provider'
import { createTestIdentity } from '../utils/test-identity'
import type { IConfigComponent } from '@well-known-components/interfaces'

const ERC1271_MAGIC_VALUE = '0x1626ba7e' + '0'.repeat(56)

type Answer = (request: IncomingMessage, response: ServerResponse, rpc: { id: number; method: string }) => void

let server: Server
let answer: Answer
let received: string[]
let identity: AuthIdentity

const respondJson = (response: ServerResponse, body: string) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(body)
}

const validateThroughRpc = async () => {
  const address = server.address() as AddressInfo
  const config = { getString: jest.fn().mockResolvedValue(`http://127.0.0.1:${address.port}`) } as unknown as IConfigComponent
  const l1Provider = await createL1Provider({ config }, { timeoutInMilliseconds: 200 })
  return validateAuthChain(asContractAccountChain(identity.authChain), l1Provider)
}

beforeEach(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => (raw += chunk))
    request.on('end', () => {
      const rpc = JSON.parse(raw)
      received.push(rpc.method)
      answer(request, response, rpc)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

// A failure the provider left unhandled would either hang these tests or fail them through Jest's
// own unhandled-rejection check; each case must instead reject the validation, for its own reason.
beforeEach(async () => {
  identity = await createTestIdentity()
  received = []
})

describe('when the RPC confirms the signature', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) => respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }))
  })

  it('should accept the chain, having asked the account', async () => {
    await expect(validateThroughRpc()).resolves.toEqual({
      sender: identity.authChain[0].payload,
      finalAuthority: identity.ephemeralIdentity.address
    })
    expect(received).toContain('eth_call')
  })
})

describe('when the RPC confirms the signature and says there is no error', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) =>
      respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: null, result: ERC1271_MAGIC_VALUE }))
  })

  it('should accept the chain', async () => {
    await expect(validateThroughRpc()).resolves.toEqual({
      sender: identity.authChain[0].payload,
      finalAuthority: identity.ephemeralIdentity.address
    })
  })
})

describe('when the RPC answers with a very long JSON-RPC error message', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) =>
      respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: { code: -32000, message: 'x'.repeat(5000) } }))
  })

  it('should cap how much of it is passed on', async () => {
    const error = await validateThroughRpc().catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('x'.repeat(201))
  })
})

describe('when the RPC answers with an error status', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(502)
      response.end('Bad Gateway')
    }
  })

  it('should reject the chain without exposing the upstream status', async () => {
    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
    expect(received).toContain('eth_call')
  })
})

describe('when the RPC answers 200 with a body that is not JSON', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<html>not json</html>')
    }
  })

  it('should reject the chain without exposing the unreadable body', async () => {
    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
    expect(received).toContain('eth_call')
  })
})

describe('when the RPC sends its headers and then stalls the body', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"id":')
    }
  })

  it('should give up at the RPC deadline and reject the chain', async () => {
    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
    expect(received).toContain('eth_call')
  })
})

describe('when the RPC answers with a JSON-RPC error', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) =>
      respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted' } }))
  })

  it('should reject the chain without exposing the RPC message', async () => {
    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
  })
})

describe('when the RPC answers with a JSON-RPC error that is not shaped like one', () => {
  beforeEach(() => {
    // An `error` whose conversion to a string throws, and one whose `message` is not a string.
    answer = (_request, response, rpc) =>
      respondJson(
        response,
        rpc.method === 'eth_call'
          ? JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { toString: 1 } })
          : JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { message: { toString: 1 } } })
      )
  })

  it('should reject the chain with a generic RPC failure', async () => {
    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
  })
})

describe('when the RPC answers 200 with JSON that is not a JSON-RPC response', () => {
  const bodies: [string, string][] = [
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
    ['an object with no result', '{}'],
    ['a numeric result', '{"jsonrpc":"2.0","id":1,"result":123}'],
    ['an array result', '{"jsonrpc":"2.0","id":1,"result":[1,2,3]}'],
    ['a deeply nested array', '['.repeat(20_000) + ']'.repeat(20_000)]
  ]

  it.each(bodies)('should reject the chain when it is %s', async (_shape, body) => {
    answer = (_request, response) => respondJson(response, body)

    await expect(validateThroughRpc()).rejects.toThrow(/RPC request failed/)
    expect(received).toContain('eth_call')
  })
})

describe('when the code handling a response throws', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) => respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }))
  })

  it('should contain the throw, rather than leave it to surface as an unhandled rejection', async () => {
    const address = server.address() as AddressInfo
    const config = { getString: jest.fn().mockResolvedValue(`http://127.0.0.1:${address.port}`) } as unknown as IConfigComponent
    const l1Provider = await createL1Provider({ config }, { timeoutInMilliseconds: 200 })
    const handled = new Promise<void>(resolve =>
      l1Provider.sendAsync({ id: 1, method: 'eth_call', params: [] }, () => {
        resolve()
        throw new Error('The response handler failed')
      })
    )

    await handled
    // Let a rejection escaping the provider reach Jest's unhandled-rejection check.
    await new Promise(resolve => setTimeout(resolve, 20))
  })
})
