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
// `globalMax` is a second, IP-independent cap over the same window protecting the
// paid Tenderly upstream: `X-Forwarded-For` is client-spoofable, so the per-IP
// budget alone cannot bound total upstream spend.
export function createSimulationHandler(allowedOrigins: Set<string>, rateLimit: { max: number; windowSeconds: number }, globalMax: number) {
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
    const perIp = await rateLimiter.consume('simulations', ip, rateLimit)
    if (!perIp.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(perIp.retryAfterSeconds) },
        body: { error: 'Too many requests' } satisfies InvalidResponseMessage
      }
    }

    // 2b. Global cap over the same window, independent of the (spoofable) client
    //     IP, so a distributed flood cannot run up the paid Tenderly upstream.
    const global = await rateLimiter.consume('simulations-global', 'all', { max: globalMax, windowSeconds: rateLimit.windowSeconds })
    if (!global.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(global.retryAfterSeconds) },
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

      // Our own client-input errors carry safe, controlled messages we can echo.
      if (e instanceof UnsupportedChainError || e instanceof InvalidSimulationParamsError) {
        logger.log(`Simulation rejected: ${message}`)
        return { status: 400, body: { error: message } satisfies InvalidResponseMessage }
      }

      // Tenderly's 400 detail is uncontrolled upstream text — log it, but return a
      // generic message so upstream internals are never echoed to the client.
      if (e instanceof TenderlyBadRequestError) {
        logger.log(`Simulation rejected by Tenderly: ${message}`)
        return { status: 400, body: { error: 'Invalid simulation request' } satisfies InvalidResponseMessage }
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
