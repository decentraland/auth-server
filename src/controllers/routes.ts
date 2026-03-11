import { Router } from '@dcl/http-server'
import { wellKnownComponents } from 'decentraland-crypto-middleware'
import type { GlobalContext } from '../types/components'
import { createIdentityHandler } from './handlers/identity-handlers/create-identity-handler'
import { getIdentityHandler } from './handlers/identity-handlers/get-identity-handler'
import { createRequestHandler } from './handlers/request-handlers/create-request-handler'
import { getRequestHandler } from './handlers/request-handlers/get-request-handler'
import { getRequestOutcomeHandler } from './handlers/request-handlers/get-request-outcome-handler'
import { getValidationStatusHandler } from './handlers/request-handlers/get-validation-status-handler'
import { notifyValidationHandler } from './handlers/request-handlers/notify-validation-handler'
import { submitOutcomeHandler } from './handlers/request-handlers/submit-outcome-handler'
import { createCheckpointHandler } from './handlers/onboarding-handlers/create-checkpoint-handler'

export function setupRouter(): Router<GlobalContext> {
  const router = new Router<GlobalContext>()
  const requireSignedFetch = wellKnownComponents({
    optional: false,
    onError: err => ({
      error: err.message,
      message: 'This endpoint requires a signed fetch request. See ADR-44.'
    }),
    verifyMetadataContent: metadata => metadata?.signer !== 'decentraland-kernel-scene'
  })

  router.post('/requests', createRequestHandler)
  router.get('/v2/requests/:requestId', getRequestHandler)
  router.post('/v2/requests/:requestId/outcome', submitOutcomeHandler)
  router.get('/requests/:requestId', getRequestOutcomeHandler)
  router.post('/v2/requests/:requestId/validation', notifyValidationHandler)
  router.get('/v2/requests/:requestId/validation', getValidationStatusHandler)

  router.post('/identities', requireSignedFetch, createIdentityHandler)
  router.get('/identities/:id', getIdentityHandler)

  router.post('/onboarding/checkpoint', createCheckpointHandler)

  return router
}
