import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { AddressInfo } from 'net'
import { AuthIdentity } from '@dcl/crypto'
import { SignatureValidationInfrastructureError } from '@dcl/crypto-middleware'
import type { JsonRpcCallback } from '@dcl/crypto-middleware'
import { createL1Provider, IL1Provider } from '../../src/adapters/l1-provider'
import { validateAuthChain } from '../../src/logic/auth-chain'
import { asContractAccountChain } from '../utils/l1-provider'
import { createTestIdentity } from '../utils/test-identity'
import type { IConfigComponent } from '@well-known-components/interfaces'

const ERC1271_MAGIC_VALUE = '0x1626ba7e' + '0'.repeat(56)
const UPSTREAM_SECRET = 'sk-example123'

type Answer = (request: IncomingMessage, response: ServerResponse, rpc: { id: number; method: string }) => void
type Outcome = { sender: string; finalAuthority: string } | Error

const respondJson = (response: ServerResponse, body: string): void => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(body)
}

/** Answers the block lookups crypto makes after an ERC-1271 check fails at the latest block. */
const blockResult = (rpc: { id: number; method: string }): string =>
  JSON.stringify({
    id: rpc.id,
    jsonrpc: '2.0',
    result: rpc.method === 'eth_blockNumber' ? '0x64' : { number: '0x64', timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) }
  })

const configFor = (url: string): IConfigComponent =>
  ({ requireString: jest.fn().mockResolvedValueOnce(url) } as unknown as IConfigComponent)

describe('when validating a contract-account chain through the L1 provider', () => {
  let server: Server
  let answer: Answer
  let received: string[]
  let identity: AuthIdentity
  let l1Provider: IL1Provider
  let outcome: Outcome

  const validate = (timeoutInMilliseconds: number): Promise<Outcome> =>
    createL1Provider({ config: configFor(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) }, { timeoutInMilliseconds })
      .then(provider => {
        l1Provider = provider
        return validateAuthChain(asContractAccountChain(identity.authChain), provider)
      })
      .catch((error: Error) => error)

  beforeEach(async () => {
    received = []
    identity = await createTestIdentity()
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

  describe('and the RPC confirms the signature', () => {
    beforeEach(async () => {
      answer = (_request, response, rpc) =>
        respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }))
      outcome = await validate(5_000)
    })

    it('should accept the chain with its sender and final authority', () => {
      expect(outcome).toEqual({ sender: identity.authChain[0].payload, finalAuthority: identity.ephemeralIdentity.address })
    })

    it('should ask the account through eth_call', () => {
      expect(received).toContain('eth_call')
    })
  })

  describe('and the RPC confirms the signature while saying there is no error', () => {
    beforeEach(async () => {
      answer = (_request, response, rpc) =>
        respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: null, result: ERC1271_MAGIC_VALUE }))
      outcome = await validate(5_000)
    })

    it('should accept the chain with its sender and final authority', () => {
      expect(outcome).toEqual({ sender: identity.authChain[0].payload, finalAuthority: identity.ephemeralIdentity.address })
    })
  })

  describe('and the contract reverts', () => {
    beforeEach(async () => {
      answer = (_request, response, rpc) =>
        respondJson(
          response,
          rpc.method === 'eth_call'
            ? JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: { code: 3, message: `execution reverted: ${UPSTREAM_SECRET}` } })
            : blockResult(rpc)
        )
      outcome = await validate(5_000)
    })

    it('should reject the chain as an invalid signature rather than an outage', () => {
      expect(outcome).not.toBeInstanceOf(SignatureValidationInfrastructureError)
    })

    it('should reject the chain without exposing the revert message', () => {
      expect((outcome as Error).message).not.toContain(UPSTREAM_SECRET)
    })
  })

  describe('and the RPC answers with a node error', () => {
    beforeEach(async () => {
      answer = (_request, response, rpc) =>
        respondJson(
          response,
          JSON.stringify({ id: rpc.id, jsonrpc: '2.0', error: { code: -32005, message: `limit exceeded ${UPSTREAM_SECRET}` } })
        )
      outcome = await validate(5_000)
    })

    it('should reject the chain as an outage with a generic message', () => {
      expect(outcome).toEqual(new SignatureValidationInfrastructureError('RPC request failed'))
    })

    it('should reject the chain without exposing the node message', () => {
      expect((outcome as Error).message).not.toContain(UPSTREAM_SECRET)
    })
  })

  describe('and the RPC answers with a JSON-RPC error that is not shaped like one', () => {
    beforeEach(async () => {
      answer = (_request, response, rpc) => respondJson(response, JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { toString: 1 } }))
      outcome = await validate(5_000)
    })

    it('should reject the chain as an outage with a generic message', () => {
      expect(outcome).toEqual(new SignatureValidationInfrastructureError('RPC request failed'))
    })
  })

  describe('and the RPC answers with an error status', () => {
    beforeEach(async () => {
      answer = (_request, response) => {
        response.writeHead(502)
        response.end(`Bad Gateway ${UPSTREAM_SECRET}`)
      }
      outcome = await validate(5_000)
    })

    it('should reject the chain as an outage without exposing the upstream body', () => {
      expect(outcome).toEqual(new SignatureValidationInfrastructureError('RPC request failed'))
    })
  })

  describe('and the RPC sends its headers and then stalls the body', () => {
    beforeEach(async () => {
      answer = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{"id":')
      }
      outcome = await validate(200)
    })

    it('should give up at the RPC deadline and reject the chain as an outage', () => {
      expect(outcome).toEqual(new SignatureValidationInfrastructureError('RPC request failed'))
    })
  })

  describe.each([
    ['a body that is not JSON', '<html>not json</html>'],
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
    ['an object with no result', '{}'],
    ['a numeric result', '{"jsonrpc":"2.0","id":1,"result":123}'],
    ['an array result', '{"jsonrpc":"2.0","id":1,"result":[1,2,3]}'],
    ['a deeply nested array', '['.repeat(20_000) + ']'.repeat(20_000)]
  ])('and the RPC answers 200 with %s', (_shape, body) => {
    beforeEach(async () => {
      answer = (_request, response) => respondJson(response, body)
      outcome = await validate(5_000)
    })

    it('should reject the chain as an outage with a generic message', () => {
      expect(outcome).toEqual(new SignatureValidationInfrastructureError('RPC request failed'))
    })
  })

  describe('and the code handling a response throws', () => {
    let throwingCallback: jest.Mock<void, Parameters<JsonRpcCallback>>

    beforeEach(async () => {
      answer = (_request, response, rpc) =>
        respondJson(response, JSON.stringify({ id: rpc.id, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }))
      l1Provider = await createL1Provider({ config: configFor(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) })
      await new Promise<void>(resolve => {
        throwingCallback = jest.fn<void, Parameters<JsonRpcCallback>>(() => {
          resolve()
          throw new Error('The response handler failed')
        })
        l1Provider.sendAsync({ id: 1, method: 'eth_call', params: [] }, throwingCallback)
      })
      // Jest fails the test on an unhandled rejection, which surfaces after the microtask queue drains.
      await new Promise(resolve => setImmediate(resolve))
    })

    it('should invoke the callback once with the result, containing its exception', () => {
      expect(throwingCallback.mock.calls).toEqual([[null, { id: 1, jsonrpc: '2.0', result: ERC1271_MAGIC_VALUE }]])
    })
  })
})

describe('when creating the L1 provider without ETH_RPC_URL', () => {
  let creation: Error | undefined

  beforeEach(async () => {
    const config = { requireString: jest.fn().mockRejectedValueOnce(new Error('Configuration: string ETH_RPC_URL is required')) }
    creation = await createL1Provider({ config: config as unknown as IConfigComponent }).then(
      () => undefined,
      (error: Error) => error
    )
  })

  it('should fail instead of falling back to another network', () => {
    expect(creation?.message).toBe('Configuration: string ETH_RPC_URL is required')
  })
})
