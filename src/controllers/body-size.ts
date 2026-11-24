import type { IHttpServerComponent } from '@dcl/core-commons'
import type { FullHttpServerComponent } from '@dcl/http-server'
import { createCorsMiddleware, getActualResponseCorsHeaders, type CorsOptions } from '@dcl/http-server/dist/cors'
import { MAX_BODY_SIZE_BYTES, MAX_REQUEST_MESSAGE_SIZE_BYTES } from '../ports/server/constants'

// The path of `POST /requests` as the router matches it: whatever the case, with one optional
// trailing slash (path-to-regexp, neither sensitive nor strict).
const REQUEST_CREATION_PATH = /^\/requests\/?$/i

/**
 * The largest body a request may carry: MAX_REQUEST_MESSAGE_SIZE_BYTES for creating a signing
 * request (`POST /requests`), MAX_BODY_SIZE_BYTES for anything else.
 */
export function bodySizeBoundFor(method: string, pathname: string): number {
  return method.toUpperCase() === 'POST' && REQUEST_CREATION_PATH.test(pathname) ? MAX_REQUEST_MESSAGE_SIZE_BYTES : MAX_BODY_SIZE_BYTES
}

function isPayloadTooLargeError(error: unknown): boolean {
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown }
  return status === 413 || statusCode === 413
}

/** The body read whole, or null once it runs past `bound` bytes. */
async function readUpTo(body: ReadableStream<Uint8Array>, bound: number): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > bound) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }

  const whole = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    whole.set(chunk, offset)
    offset += chunk.byteLength
  }
  return whole
}

/**
 * Holds every request body to its route's bound (bodySizeBoundFor) before anything handles the
 * request. It reads the body whole, up to the bound, and hands on a request carrying those bytes, so
 * a body past the bound is a `413` whether or not it declares its length, and whether or not the
 * handler would have read it: a handler that never reads its body still never runs for an
 * oversized one. A body the server never streams (on a GET or HEAD) can't be measured, so one that
 * its framing announces without a length is refused outright.
 *
 * The `413` carries the CORS headers of an actual response, as the server's own early rejection
 * does, so a cross-origin client can read it. Mount it with mountBodySizeBound.
 */
export function createBodySizeBoundMiddleware<Context extends object>(cors: CorsOptions): IHttpServerComponent.IRequestHandler<Context> {
  return async (context, next) => {
    const { request, url } = context
    const bound = bodySizeBoundFor(request.method, url.pathname)

    // The same answer @dcl/http-server gives an oversized body. `Connection: close` frees the
    // socket, as the rest of the body is never going to be read.
    const payloadTooLarge = (): IHttpServerComponent.IResponse => {
      const headers = getActualResponseCorsHeaders(cors, request)
      headers.set('connection', 'close')
      return { status: 413, headers, body: 'Payload Too Large' }
    }

    const declared = Number(request.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > bound) {
      return payloadTooLarge()
    }

    if (!request.body) {
      return request.headers.has('transfer-encoding') ? payloadTooLarge() : next()
    }

    let body: Uint8Array | null
    try {
      body = await readUpTo(request.body, bound)
    } catch (error) {
      // The server's own bound tripped while the body was read.
      if (isPayloadTooLargeError(error)) return payloadTooLarge()
      throw error
    }
    if (body === null) {
      return payloadTooLarge()
    }

    context.request = new Request(request.url, { method: request.method, headers: request.headers, body })
    return next()
  }
}

/**
 * Puts the body bound at the head of the server's middleware chain. createServerComponent has
 * already installed its CORS middleware, which answers a preflight without running anything after
 * it, so the chain is rebuilt with the bound first and the same CORS middleware right after it.
 * Call it right after creating the server, before any other `use`.
 */
export function mountBodySizeBound<Context extends object>(server: FullHttpServerComponent<Context>, cors: CorsOptions): void {
  server.resetMiddlewares()
  server.use(createBodySizeBoundMiddleware<Context>(cors))
  server.use(createCorsMiddleware<Context>(cors))
}
