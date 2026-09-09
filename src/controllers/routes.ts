import { rejectIfSigner, wellKnownComponents } from '@dcl/crypto-middleware'
import { bearerTokenMiddleware, errorHandler } from '@dcl/http-commons'
import { Router, createBodySizeLimitMiddleware } from '@dcl/http-server'
import { DEFAULT_BODY_SIZE_BYTES } from '../ports/server/constants'
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

/**
 * Metadata keys `DELETE /accounts` authorizes on, in their canonical spelling.
 *
 * Declaring them opts that one route into accepting requests still signed with the pre-6.0.0
 * payload, which folded the whole joined string before signing while delivering the metadata header
 * verbatim. Since 6.0.0 the metadata bytes are signed as delivered, so the two disagree for any
 * metadata carrying uppercase. The deletion route carries `didToken` -- an uppercase key, and a
 * mixed-case token value -- so the account-deletion flow in `sites` is a 401 on every attempt
 * without this. `sites` still resolves `decentraland-crypto-fetch` 2.0.1 transitively, through
 * @dcl/social-rpc-client rather than a dependency of its own, so it cannot be fixed from there
 * either without restructuring that first.
 *
 *   signer    what `rejectIfSigner` gates on. Not read by a handler, but the fold leaves key casing
 *             outside the signature, so a legacy request could otherwise deliver `Signer` and have
 *             the gate read the field as absent.
 *   didToken  read by `validateAccountDeletionMetadata` and handed to Magic.
 *
 * Keys only. The fold leaves property *values* outside the legacy signature as well, and no key list
 * can bind them -- so a legacy-signed `didToken` value is malleable in transit. That is tolerable
 * here precisely because the token is self-authenticating: Magic verifies its signature, and the
 * adapter binds it to the recovered signed-fetch address, to its issue time, and to single use.
 * Re-casing base64url corrupts the token, so a tampered one is rejected rather than honoured.
 *
 * Removable once `sites` signs the 6.x payload.
 */
const ACCOUNT_DELETION_CANONICAL_METADATA_KEYS = ['signer', 'didToken']

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()
  const { config } = globalContext.components

  const onboardingApiKey = await config.requireString('ONBOARDING_API_KEY')
  const adminEnabled = (await config.getString('ONBOARDING_ADMIN_ENABLED')) === 'true'
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')

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
  // Global (IP-independent) cap over the same window, protecting the paid Tenderly
  // upstream from a distributed flood that stays under the per-IP budget.
  const simulationRateLimitGlobalMax = (await config.getNumber('SIMULATION_RATE_LIMIT_GLOBAL_MAX')) ?? 600

  /**
   * Builds a signed-fetch middleware (ADR-44). Blocks scene-originated requests.
   *
   * @param canonicalMetadataKeys When present, opts the routes using this instance into accepting
   *   the pre-6.0.0 signed payload as a fallback. Absent — the default — means current format only.
   */
  const createSignedFetchMiddleware = (canonicalMetadataKeys?: string[]) =>
    wellKnownComponents({
      optional: false,
      onError: err => ({
        error: err.message,
        message: 'This endpoint requires a signed fetch request. See ADR-44.'
      }),
      metadataValidator: rejectIfSigner('decentraland-kernel-scene'), // prevent requests from scenes
      canonicalMetadataKeys
    })

  // Current signed-payload format only. `POST /identities` stays here: both its callers send
  // metadata that folds to itself — `sites` sends an all-lowercase `{ signer, intent }` and the auth
  // app sends none at all — so neither is affected by the format change and neither needs a
  // fallback. Keeping the relaxation off this route is what stops it becoming service-wide by
  // default.
  const signedFetchMiddleware = createSignedFetchMiddleware()

  // `DELETE /accounts` only. See ACCOUNT_DELETION_CANONICAL_METADATA_KEYS above for why that route
  // needs the older format accepted and what declaring those keys does and does not bind.
  const accountDeletionSignedFetchMiddleware = createSignedFetchMiddleware(ACCOUNT_DELETION_CANONICAL_METADATA_KEYS)

  router.use(errorHandler)

  // Every route keeps the service's historical body cap. Only `/simulations` needs the larger transport
  // cap the server is configured with (see MAX_BODY_SIZE_BYTES), since it carries calldata.
  const defaultBodyLimit = createBodySizeLimitMiddleware(DEFAULT_BODY_SIZE_BYTES)
  router.use((context, next) => (context.url.pathname === '/simulations' ? next() : defaultBodyLimit(context, next)))

  // Health probes
  router.get('/health/ready', readyHandler)
  router.get('/health/startup', startupHandler)
  router.get('/health/live', liveHandler)

  // Request lifecycle endpoints
  router.post('/requests', createRequestHandler({ requestExpirationInSeconds }))
  router.get('/v2/requests/:requestId', getRequestHandler)
  router.post('/v2/requests/:requestId/validation', notifyRequestValidationHandler)
  router.get('/v2/requests/:requestId/validation', getRequestValidationStatusHandler)
  router.get('/requests/:requestId', getOutcomeHandler)
  router.post('/v2/requests/:requestId/outcome', createOutcomeHandler)

  // Transaction simulation endpoint (Tenderly-backed). Public, rate-limited per IP.
  router.post('/simulations', createSimulationHandler(simulationAllowedOrigins, simulationRateLimit, simulationRateLimitGlobalMax))

  // Identity endpoints
  router.post('/identities', signedFetchMiddleware, createIdentityHandler)
  router.get('/identities/:id', getIdentityHandler)

  // Account deletion endpoint — DCL signed-fetch + a fresh Magic DID token.
  router.delete('/accounts', accountDeletionSignedFetchMiddleware, createDeleteAccountHandler(accountDeletionAllowedOrigins))

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
