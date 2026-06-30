import { IHttpServerComponent } from '@dcl/core-commons'
import { isErrorWithMessage } from '../logic/error-handling'

/**
 * Catches errors thrown by downstream handlers and turns them into a `500`
 * response. Handlers in this service generally catch their own errors and map
 * them to specific status codes; this is the final safety net so an unexpected
 * throw doesn't bubble up as an unhandled rejection.
 */
export async function errorHandler<Context extends object>(
  _context: IHttpServerComponent.DefaultContext<Context>,
  next: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  try {
    return await next()
  } catch (error) {
    const message = isErrorWithMessage(error) ? error.message : 'Unknown error'
    return {
      status: 500,
      body: { error: 'Internal server error', message }
    }
  }
}

/**
 * Per-route middleware that requires a `Bearer <token>` Authorization header
 * matching `expectedToken`. Responds with `401 { error: 'Unauthorized' }` when
 * the header is missing or does not match. Mirrors the previous express bearer
 * checks used by the onboarding endpoints.
 */
export function bearerTokenMiddleware<Context extends object>(expectedToken: string): IHttpServerComponent.IRequestHandler<Context> {
  return async (context, next) => {
    const authHeader = context.request.headers.get('authorization') ?? ''
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (provided !== expectedToken) {
      return { status: 401, body: { error: 'Unauthorized' } }
    }
    return next()
  }
}
