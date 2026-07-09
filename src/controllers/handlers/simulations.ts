import { TenderlyBadRequestError, TenderlyRateLimitError, TenderlyUnavailableError } from '../../adapters/tenderly'
import { isErrorWithMessage } from '../../logic/error-handling'
import { InvalidSimulationParamsError, UnsupportedChainError } from '../../logic/simulation'
import { InvalidResponseMessage } from '../../ports/server/types'
import { validateSimulationRequest } from '../../ports/server/validations'
import { HandlerContextWithPath } from '../../types'
import { getClientIp, parseJsonBody } from '../utils'

// POST /simulations — simulates a transaction via Tenderly and returns a normalized
// summary (asset transfers, token approvals, would-revert warning). Public endpoint,
// so it is protected by an optional exact-origin allowlist plus a fixed-window rate
// limiter keyed on the client IP.
//
// `allowedOrigins` is an exact-match allowlist of browser Origins (empty = skip).
// `rateLimit` is the per-IP fixed-window budget (max requests per window).
export function createSimulationHandler(allowedOrigins: Set<string>, rateLimit: { max: number; windowSeconds: number }) {
  return async function simulationHandler(context: HandlerContextWithPath<'simulation' | 'rateLimiter' | 'logs', '/simulations'>) {
    const {
      components: { simulation, rateLimiter, logs },
      request
    } = context

    const logger = logs.getLogger('simulations-endpoint')

    // 1. Defense-in-depth: restrict to official Decentraland browser origins.
    if (allowedOrigins.size > 0) {
      const origin = (request.headers.get('origin') || '').toLowerCase()
      if (!origin || !allowedOrigins.has(origin)) {
        logger.log(`Rejected simulation from disallowed origin: ${request.headers.get('origin') ?? 'none'}`)
        return { status: 403, body: { error: 'Origin not allowed' } satisfies InvalidResponseMessage }
      }
    }

    // 2. Rate limit per client IP.
    const ip = getClientIp(request.headers)
    const { allowed, retryAfterSeconds } = await rateLimiter.consume('simulations', ip, rateLimit)
    if (!allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
        body: { error: 'Too many requests' } satisfies InvalidResponseMessage
      }
    }

    // 3. Parse + validate. Both throw InvalidRequestError → errorHandler maps to 400.
    const rawBody = await parseJsonBody(request)
    const body = validateSimulationRequest(rawBody)

    // 4. Simulate + map typed errors to HTTP statuses.
    try {
      return { status: 200, body: await simulation.simulateTransaction(body) }
    } catch (e) {
      const message = isErrorWithMessage(e) ? e.message : 'Unknown error'

      if (e instanceof UnsupportedChainError || e instanceof InvalidSimulationParamsError || e instanceof TenderlyBadRequestError) {
        logger.log(`Simulation rejected: ${message}`)
        return { status: 400, body: { error: message } satisfies InvalidResponseMessage }
      }

      if (e instanceof TenderlyRateLimitError) {
        logger.log(`Simulation rate limited by Tenderly: ${message}`)
        return { status: 429, body: { error: 'Too many requests' } satisfies InvalidResponseMessage }
      }

      if (e instanceof TenderlyUnavailableError) {
        logger.warn(`Simulation upstream unavailable: ${message}`)
        return { status: 502, body: { error: 'Simulation provider unavailable' } satisfies InvalidResponseMessage }
      }

      // TenderlyAuthError (our misconfig) and anything unexpected — never echo the
      // upstream detail (it may reference the access key). Log internally only.
      logger.error(`Simulation failed: ${message}`)
      return { status: 500, body: { error: 'Internal server error' } satisfies InvalidResponseMessage }
    }
  }
}
