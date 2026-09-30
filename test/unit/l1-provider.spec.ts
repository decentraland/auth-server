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
let identity: AuthIdentity

const validateThroughRpc = async () => {
  const address = server.address() as AddressInfo
  const config = { getString: jest.fn().mockResolvedValue(`http://127.0.0.1:${address.port}`) } as unknown as IConfigComponent
  const l1Provider = await createL1Provider({ config }, { timeoutInMilliseconds: 200 })
  return validateAuthChain(asContractAccountChain(identity.authChain), l1Provider)
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => (raw += chunk))
    request.on('end', () => answer(request, response, JSON.parse(raw)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

// A failure the provider leaves unhandled would either hang these tests or fail them through Jest's
// own unhandled-rejection check; each case must instead reject the validation.
beforeEach(async () => {
  identity = await createTestIdentity()
})

describe('when the RPC confirms the signature', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: rpc.id, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }))
    }
  })

  it('should accept the chain', async () => {
    await expect(validateThroughRpc()).resolves.toEqual({
      sender: identity.authChain[0].payload,
      finalAuthority: identity.ephemeralIdentity.address
    })
  })
})

describe('when the RPC answers with an error status', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(502)
      response.end('Bad Gateway')
    }
  })

  it('should reject the chain', async () => {
    await expect(validateThroughRpc()).rejects.toThrow()
  })
})

describe('when the RPC answers 200 with a body that is not JSON', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<html>not json</html>')
    }
  })

  it('should reject the chain instead of leaving the request unsettled', async () => {
    await expect(validateThroughRpc()).rejects.toThrow()
  })
})

describe('when the RPC answers 200 with a JSON null', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('null')
    }
  })

  it('should reject the chain instead of leaving the request unsettled', async () => {
    await expect(validateThroughRpc()).rejects.toThrow()
  })
})

describe('when the RPC sends its headers and then stalls the body', () => {
  beforeEach(() => {
    answer = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"id":')
    }
  })

  it('should give up at the deadline and reject the chain', async () => {
    await expect(validateThroughRpc()).rejects.toThrow()
  })
})

describe('when the RPC answers with a JSON-RPC error', () => {
  beforeEach(() => {
    answer = (_request, response, rpc) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: { code: -32000, message: 'execution reverted' } }))
    }
  })

  it('should reject the chain', async () => {
    await expect(validateThroughRpc()).rejects.toThrow()
  })
})
