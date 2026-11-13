import { AuthIdentity, Authenticator } from '@dcl/crypto'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createOutcomeHandler, getOutcomeHandler } from '../../src/controllers/handlers/requests'
import { getOutcomeSignaturePayload } from '../../src/logic/outcomes'
import { outcomeSocketHandler } from '../../src/logic/socket-server/handlers/outcome'
import { SocketHandlerContext } from '../../src/logic/socket-server/types'
import { SignedOutcomeMessage } from '../../src/ports/server/types'
import { createStorageComponent } from '../../src/ports/storage/component'
import { IStorageComponent, StorageRequest } from '../../src/ports/storage/types'
import { createMockLogs } from '../mocks'
import { signTestOutcome } from '../utils/outcome'
import { createTestIdentity } from '../utils/test-identity'

describe.each(['http', 'socket'])('when authenticating an outcome via %s', transport => {
  let identity: AuthIdentity
  let sender: string
  let storage: IStorageComponent
  let cache: ReturnType<typeof createInMemoryCacheComponent>
  let request: StorageRequest
  let message: SignedOutcomeMessage
  let emit: jest.Mock
  let submit: (body: unknown, requestId?: string) => Promise<{ status: number; body?: unknown }>
  let poll: () => ReturnType<typeof getOutcomeHandler>

  beforeEach(async () => {
    identity = await createTestIdentity()
    sender = identity.authChain[0].payload
    cache = createInMemoryCacheComponent()
    storage = createStorageComponent({ cache })
    request = {
      requestId: 'request-1',
      sender: identity.authChain[0].payload,
      method: 'personal_sign',
      params: ['message'],
      code: 1,
      requiresValidation: false,
      expiration: new Date(Date.now() + 120_000)
    }
    await storage.setRequest(request.requestId, request)
    message = signTestOutcome(identity, { requestId: request.requestId, sender, result: 'signed-result' })
    emit = jest.fn().mockReturnValue(true)
    poll = () =>
      getOutcomeHandler({
        params: { requestId: request.requestId },
        components: { storage, logs: createMockLogs() }
      } as unknown as Parameters<typeof getOutcomeHandler>[0])
    submit = async (body, requestId = request.requestId) => {
      if (transport === 'socket') {
        const result = await outcomeSocketHandler(
          { components: { storage }, logger: createMockLogs().getLogger('test'), emitToSocket: emit } as unknown as SocketHandlerContext,
          body
        )
        return 'error' in result ? { status: 400, body: result } : { status: 200 }
      }
      return createOutcomeHandler({
        params: { requestId },
        components: { storage, logs: createMockLogs(), socketServer: { emitToSocket: emit } },
        request: new Request('http://localhost/v2/requests/' + requestId + '/outcome', { method: 'POST', body: JSON.stringify(body) })
      } as unknown as Parameters<typeof createOutcomeHandler>[0])
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should accept and store the authenticated outcome without its proof', async () => {
    expect((await submit(message)).status).toBe(200)
    expect((await storage.getRequest(request.requestId))?.response).toEqual({
      requestId: request.requestId,
      sender: request.sender,
      result: 'signed-result'
    })
  })

  it('should use the client protocol canonical JSON vector', () => {
    expect(
      getOutcomeSignaturePayload('r', { sender: 's', expiresAt: 123, result: { z: ['CaseSensitive', 2], a: { token: 'Token' } } })
    ).toBe(
      'decentraland-auth-outcome-v1\n{"expiresAt":123,"requestId":"r","result":{"a":{"token":"Token"},"z":["CaseSensitive",2]},"sender":"s"}'
    )
  })

  describe('and the authenticated outcome reports a rejection', () => {
    beforeEach(() => {
      message = signTestOutcome(identity, { requestId: request.requestId, sender, error: { code: 4001, message: 'User rejected' } })
    })
    it('should preserve the signed rejection', async () => {
      expect((await submit(message)).status).toBe(200)
      expect((await storage.getRequest(request.requestId))?.response?.error).toEqual({ code: 4001, message: 'User rejected' })
    })
    describe('and the rejection text is modified after signing', () => {
      beforeEach(() => {
        message.error = { code: 4001, message: 'Changed' }
      })
      it('should reject it', async () => {
        expect((await submit(message)).status).not.toBe(200)
      })
    })
  })

  describe('and the outcome write fails after reservation', () => {
    beforeEach(() => {
      jest.spyOn(cache, 'set').mockRejectedValueOnce(new Error('Storage unavailable'))
    })
    it('should fail closed without notifying or allowing a replacement', async () => {
      await expect(submit(message)).rejects.toThrow('Storage unavailable')
      expect((await submit(message)).status).not.toBe(200)
      expect(emit).not.toHaveBeenCalled()
    })
  })

  describe('and two authenticated outcomes arrive concurrently', () => {
    let otherMessage: SignedOutcomeMessage
    beforeEach(() => {
      otherMessage = signTestOutcome(identity, {
        requestId: request.requestId,
        sender,
        error: { code: 1, message: 'declined' }
      })
    })
    it('should accept exactly one answer', async () => {
      expect((await Promise.all([submit(message), submit(otherMessage)])).filter(result => result.status === 200)).toHaveLength(1)
    })
  })

  describe('and a validation update writes a stale request snapshot', () => {
    beforeEach(async () => {
      await submit(message)
      await storage.setRequest(request.requestId, { ...request, requiresValidation: true })
    })
    it('should retain the accepted result and reject replacement', async () => {
      expect((await submit(message)).status).not.toBe(200)
      expect((await storage.getRequest(request.requestId))?.response?.result).toBe('signed-result')
    })
  })

  describe('and someone polls the result before the requester receives it', () => {
    beforeEach(async () => {
      await submit(message)
      await poll()
    })
    it('should keep the same result available without allowing replacement', async () => {
      expect(await poll()).toEqual({ status: 200, body: { requestId: request.requestId, sender, result: 'signed-result' } })
      expect((await submit(message)).status).not.toBe(200)
    })
  })

  describe.each([
    'missing proof',
    'changed result',
    'changed sender',
    'changed expiry',
    'expired proof',
    'excessive lifetime',
    'wrong wallet',
    'expired delegation',
    'different request'
  ])('and the submission has %s', condition => {
    let body: Record<string, unknown>
    beforeEach(async () => {
      body = { ...message }
      switch (condition) {
        case 'missing proof':
          delete body.authChain
          break
        case 'changed result':
          body.result = 'changed'
          break
        case 'changed sender':
          body.sender = '0x1111111111111111111111111111111111111111'
          break
        case 'changed expiry':
          body.expiresAt = message.expiresAt + 1
          break
        case 'expired proof':
          body.expiresAt = Date.now() - 1
          break
        case 'excessive lifetime':
          body.expiresAt = Date.now() + 120_000
          break
        case 'wrong wallet':
          body.authChain = Authenticator.signPayload(await createTestIdentity(), getOutcomeSignaturePayload(request.requestId, message))
          break
        case 'expired delegation':
          identity = await createTestIdentity(-1)
          sender = identity.authChain[0].payload
          await storage.setRequest(request.requestId, { ...request, sender })
          body = signTestOutcome(identity, { requestId: request.requestId, sender, result: 'signed-result' })
          break
        case 'different request':
          body.authChain = Authenticator.signPayload(identity, getOutcomeSignaturePayload('different-request', message))
          break
      }
    })
    it('should reject without consuming the request or notifying the client', async () => {
      expect((await submit(body)).status).not.toBe(200)
      expect((await storage.getRequest(request.requestId))?.response).toBeUndefined()
      expect(emit).not.toHaveBeenCalled()
    })
  })

  describe('and the notification cannot reach the requester', () => {
    beforeEach(async () => {
      await storage.setRequest(request.requestId, { ...request, socketId: 'socket-1' })
      emit.mockReturnValueOnce(false)
    })
    it('should leave the authenticated outcome available for polling', async () => {
      expect((await submit(message)).status).toBe(200)
      expect((await storage.getRequest(request.requestId))?.response?.result).toBe('signed-result')
      expect((await storage.getRequest(request.requestId))?.fulfilled).not.toBe(true)
    })
  })
})
