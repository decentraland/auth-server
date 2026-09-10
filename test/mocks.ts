// Lightweight, framework-only test mock factories shared by unit and integration specs.
// Kept free of the runner/service wiring in `components.ts` so unit specs can import them
// without booting the whole program.
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '../src/ports/db/types'

/** Logger whose every level is a `jest.fn()`; `getLogger` always returns the same instance. */
export function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
}

/**
 * No-op pg component whose `query` resolves to an empty result set by default. The `query`
 * mock is exposed as a `jest.Mock` so specs can set per-case return values.
 */
export function createMockDbComponent(): jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] }),
    getPool: jest.fn(),
    withTransaction: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  } as unknown as jest.Mocked<Pick<IPgComponent, 'query'>> & IPgComponent
}

/**
 * A `Response` whose `body` is the given JSON, so a spec exercises the same bounded streaming read the
 * adapter performs in production rather than a hand-rolled object with only a `json()` method.
 *
 * `body` is a getter that returns a fresh stream on every access: a real response body may be read once,
 * but a spec that sets one mocked response for a whole case reads it as many times as it calls the
 * adapter, and failing on the second call would be an artefact of the mock rather than of the code.
 *
 * Pass `text` to send a body that is not valid JSON, or `contentLength` to declare a length that differs
 * from what is sent — which is what an upstream announcing an oversized body looks like.
 */
export function createJsonResponse(
  body: unknown,
  { status = 200, text, contentLength }: { status?: number; text?: string; contentLength?: number } = {}
): Response {
  const payload = text ?? JSON.stringify(body)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength))
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    get body() {
      return new Response(payload).body
    },
    text: async () => payload,
    json: async () => JSON.parse(payload)
  } as unknown as Response
}
