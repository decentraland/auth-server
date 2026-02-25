import { Router } from '@dcl/http-server'
import { wellKnownComponents } from 'decentraland-crypto-middleware'
import type { GlobalContext } from '../types/components'
import { createIdentityHandler, getIdentityHandler } from './handlers/identity-handlers'
import {
  createRequestHandler,
  getRequestHandler,
  getRequestOutcomeHandler,
  getValidationStatusHandler,
  notifyValidationHandler,
  submitOutcomeHandler
} from './handlers/request-handlers'

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

  return router
}
