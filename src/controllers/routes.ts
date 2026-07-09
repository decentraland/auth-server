import { wellKnownComponents } from '@dcl/crypto-middleware'
import { bearerTokenMiddleware, errorHandler } from '@dcl/http-commons'
import { Router } from '@dcl/http-server'
import { GlobalContext } from '../types'
import { createDeleteAccountHandler } from './handlers/accounts'
import { getPendingNudgesForSequenceHandler, runEvaluatorHandler, sendTestEmailHandler } from './handlers/admin'
import { liveHandler, readyHandler, startupHandler } from './handlers/health'
import { createIdentityHandler, getIdentityHandler } from './handlers/identities'
import { createCheckpointHandler, getPendingNudgesDashboardHandler } from './handlers/onboarding'
import {
  createOutcomeHandler,
  createRequestHandler,
  getOutcomeHandler,
  getRequestHandler,
  getRequestValidationStatusHandler,
  notifyRequestValidationHandler
} from './handlers/requests'
import { createSimulationHandler } from './handlers/simulations'

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()
  const { config } = globalContext.components

  const onboardingApiKey = await config.requireString('ONBOARDING_API_KEY')
  const adminEnabled = (await config.getString('ONBOARDING_ADMIN_ENABLED')) === 'true'
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')

  // Exact-match allowlist of browser Origins permitted to call the account
  // deletion endpoint (defense-in-depth on top of CORS). Empty disables the check.
  const accountDeletionAllowedOrigins = new Set(
    ((await config.getString('ACCOUNT_DELETION_ALLOWED_ORIGINS')) || '')
      .split(';')
      .map(origin => origin.trim().toLowerCase())
      .filter(origin => origin.length > 0)
  )

  // Exact-match allowlist of browser Origins permitted to call the simulation
  // endpoint (defense-in-depth on top of CORS). Empty disables the check.
  const simulationAllowedOrigins = new Set(
    ((await config.getString('SIMULATION_ALLOWED_ORIGINS')) || '')
      .split(';')
      .map(origin => origin.trim().toLowerCase())
      .filter(origin => origin.length > 0)
  )
  const simulationRateLimit = {
    max: await config.requireNumber('SIMULATION_RATE_LIMIT_MAX'),
    windowSeconds: await config.requireNumber('SIMULATION_RATE_LIMIT_WINDOW_SECONDS')
  }

  // Signed-fetch middleware (ADR-44). Blocks scene-originated requests.
  const signedFetchMiddleware = wellKnownComponents({
    optional: false,
    onError: err => ({
      error: err.message,
      message: 'This endpoint requires a signed fetch request. See ADR-44.'
    }),
    metadataValidator: metadata => metadata?.signer !== 'decentraland-kernel-scene' // prevent requests from scenes
  })

  router.use(errorHandler)

  // Health probes
  router.get('/health/ready', readyHandler)
  router.get('/health/startup', startupHandler)
  router.get('/health/live', liveHandler)

  // Request lifecycle endpoints
  router.post('/requests', createRequestHandler({ requestExpirationInSeconds, dclPersonalSignExpirationInSeconds }))
  router.get('/v2/requests/:requestId', getRequestHandler)
  router.post('/v2/requests/:requestId/validation', notifyRequestValidationHandler)
  router.get('/v2/requests/:requestId/validation', getRequestValidationStatusHandler)
  router.get('/requests/:requestId', getOutcomeHandler)
  router.post('/v2/requests/:requestId/outcome', createOutcomeHandler)

  // Transaction simulation endpoint (Tenderly-backed). Public, rate-limited per IP.
  router.post('/simulations', createSimulationHandler(simulationAllowedOrigins, simulationRateLimit))

  // Identity endpoints
  router.post('/identities', signedFetchMiddleware, createIdentityHandler)
  router.get('/identities/:id', getIdentityHandler)

  // Account deletion endpoint — DCL signed-fetch + a fresh Magic DID token.
  router.delete('/accounts', signedFetchMiddleware, createDeleteAccountHandler(accountDeletionAllowedOrigins))

  // Onboarding endpoints (bearer-token protected)
  router.post('/onboarding/checkpoint', bearerTokenMiddleware(onboardingApiKey), createCheckpointHandler)
  router.get('/onboarding/pending-nudges', bearerTokenMiddleware(onboardingApiKey), getPendingNudgesDashboardHandler)

  // Admin endpoints — only mounted when ONBOARDING_ADMIN_ENABLED=true (local dev / staging)
  if (adminEnabled) {
    router.post('/admin/onboarding/run-evaluator', runEvaluatorHandler)
    router.post('/admin/onboarding/send-test-email', sendTestEmailHandler)
    router.get('/admin/onboarding/pending-nudges/:sequence', getPendingNudgesForSequenceHandler)
  }

  return router
}
