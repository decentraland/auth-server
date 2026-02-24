import { Server } from 'http'
import { IBaseComponent } from '@well-known-components/interfaces'
import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { express as authMiddleware, DecentralandSignatureData } from 'decentraland-crypto-middleware'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types/components'
import type { IpHeaders } from '../../utils/ip.types'
import { METHOD_DCL_PERSONAL_SIGN, MAX_BODY_SIZE } from './constants'
import {
  HttpOutcomeMessage,
  IServerComponent,
  IdentityIdValidationResponse,
  IdentityResponse,
  InvalidResponseMessage,
  LiveResponseMessage,
  OutcomeResponseMessage,
  RecoverResponseMessage,
  RequestMessage,
  RequestResponseMessage,
  RequestValidationStatusMessage
} from './types'
import { validateHttpOutcomeMessage, validateIdentityId, validateIdentityRequest, validateRequestMessage } from './validations'

export async function createServerComponent({
  authChain,
  config,
  identityOperations,
  ipUtils,
  logs,
  metrics,
  requestOperations,
  storage,
  tracer,
  requestExpirationInSeconds,
  dclPersonalSignExpirationInSeconds
}: Pick<
  AppComponents,
  'authChain' | 'config' | 'identityOperations' | 'ipUtils' | 'logs' | 'metrics' | 'requestOperations' | 'storage' | 'tracer'
> & {
  requestExpirationInSeconds: number
  dclPersonalSignExpirationInSeconds: number
}): Promise<IServerComponent> {
  void tracer

  const getPathParam = (value: string | string[]): string => {
    return Array.isArray(value) ? value[0] : value
  }

  const sendResponse = <T>(res: Response, statusCode: number, msg: T) => {
    res.status(statusCode).json(msg)
  }

  const port = await config.requireNumber('HTTP_SERVER_PORT')
  const logger = logs.getLogger('http-server')

  const corsOptions = {
    origin: (await config.requireString('CORS_ORIGIN')).split(';').map(origin => new RegExp(origin)),
    methods: await config.requireString('CORS_METHODS')
  }

  const metricsPath = (await config.getString('WKC_METRICS_PUBLIC_PATH')) || '/metrics'
  const metricsBearerToken = await config.getString('WKC_METRICS_BEARER_TOKEN')

  let server: Server | null = null

  const start: IBaseComponent['start'] = async () => {
    if (server) {
      return
    }

    const identityLogger = logs.getLogger('identity-endpoints')
    logger.log('Starting HTTP server...')

    const app = express()

    app.use(bodyParser.json({ limit: MAX_BODY_SIZE }))
    app.use(cors(corsOptions))

    app.use((req, res, next) => {
      if (req.path === metricsPath) {
        return next()
      }

      const labels = {
        method: req.method,
        handler: '',
        code: 200
      }

      const startTimerResult = metrics.startTimer('http_request_duration_seconds', labels)
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const end = startTimerResult?.end || (() => {})

      res.on('finish', () => {
        labels.code = res.statusCode
        if (req.route?.path) {
          labels.handler = req.baseUrl + req.route.path
        }

        const contentLength = parseInt(req.get('content-length') || '0', 10) || 0
        metrics.observe('http_request_size_bytes', labels, contentLength)
        metrics.increment('http_requests_total', labels)
        end(labels)
      })

      next()
    })

    app.get('/health/ready', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/startup', (_req, res) => {
      res.sendStatus(200)
    })

    app.get('/health/live', (_req, res) => {
      return sendResponse<LiveResponseMessage>(res, 200, {
        timestamp: Date.now()
      })
    })

    app.post('/requests', async (req: Request, res: Response) => {
      const data = req.body
      let msg: RequestMessage

      try {
        msg = validateRequestMessage(data)
      } catch (e) {
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: isErrorWithMessage(e) ? e.message : 'Unknown error'
        })
      }

      let sender: string | undefined

      if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
        try {
          const { sender: validatedSender } = await authChain.validateAuthChain(msg.authChain || [])
          sender = validatedSender
        } catch (e) {
          return sendResponse<InvalidResponseMessage>(res, 400, {
            error: isErrorWithMessage(e) ? e.message : 'Unknown error'
          })
        }
      }

      const requestId = uuid()
      const expiration = requestOperations.computeRequestExpiration({
        method: msg.method,
        requestExpirationInSeconds,
        dclPersonalSignExpirationInSeconds
      })
      const code = Math.floor(Math.random() * 100)

      storage.setRequest(
        requestId,
        requestOperations.buildRequestRecord({
          requestId,
          expiration,
          code,
          method: msg.method,
          params: msg.params,
          sender
        })
      )

      sendResponse<RequestResponseMessage>(res, 201, {
        requestId,
        expiration,
        code
      })
    })

    app.get('/v2/requests/:requestId', async (req: Request, res: Response) => {
      const requestId = getPathParam(req.params.requestId)
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (requestOperations.isRequestExpired(request)) {
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      sendResponse<RecoverResponseMessage>(res, 200, requestOperations.toRecoverResponse(request))
    })

    app.post('/v2/requests/:requestId/validation', async (req: Request, res: Response) => {
      const requestId = getPathParam(req.params.requestId)
      const request = await storage.getRequest(requestId)

      if (!request) {
        logger.log(`[RID:${requestId}] Received a validation request message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        logger.log(`[RID:${requestId}] Received a validation request message for an already fulfilled request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (requestOperations.isRequestExpired(request)) {
        logger.log(`[RID:${requestId}] Received a validation request message for an expired request`)
        storage.setRequest(requestId, null)

        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      request.requiresValidation = true
      res.sendStatus(204)
    })

    app.get('/v2/requests/:requestId/validation', async (req: Request, res: Response) => {
      const requestId = getPathParam(req.params.requestId)
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (requestOperations.isRequestExpired(request)) {
        storage.setRequest(requestId, null)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      sendResponse<RequestValidationStatusMessage>(res, 200, { requiresValidation: request.requiresValidation })
    })

    app.get('/requests/:requestId', async (req: Request, res: Response) => {
      const requestId = getPathParam(req.params.requestId)
      const request = await storage.getRequest(requestId)

      if (!request) {
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (requestOperations.isRequestExpired(request)) {
        storage.setRequest(requestId, null)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      if (!request.response) {
        return sendResponse<InvalidResponseMessage>(res, 204, {
          error: `Request with id "${requestId}" has not been completed`
        })
      }

      logger.log(`[RID:${requestId}] Successfully sent outcome message to the client via HTTP`)

      storage.setRequest(
        requestId,
        requestOperations.toFulfilledRequestRecord({
          requestId,
          expiration: request.expiration
        })
      )
      sendResponse<OutcomeResponseMessage>(res, 200, request.response)
    })

    app.post('/v2/requests/:requestId/outcome', async (req: Request, res: Response) => {
      const requestId = getPathParam(req.params.requestId)

      const data = req.body
      let msg: HttpOutcomeMessage

      try {
        msg = validateHttpOutcomeMessage(data)
      } catch (e) {
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: isErrorWithMessage(e) ? e.message : 'Unknown error'
        })
      }

      const request = await storage.getRequest(requestId)

      if (!request) {
        logger.log(`[RID:${requestId}] Received an outcome message for a non-existent request`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: `Request with id "${requestId}" not found`
        })
      }

      if (request.fulfilled) {
        logger.log(`[RID:${requestId}] Received an outcome message for an already fulfilled request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has already been fulfilled`
        })
      }

      if (request.response) {
        logger.log(`[RID:${requestId}] Received an outcome message for a request that already has a response`)
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: `Request with id "${requestId}" already has a response`
        })
      }

      if (requestOperations.isRequestExpired(request)) {
        storage.setRequest(requestId, null)
        logger.log(`[RID:${requestId}] Received an outcome message for an expired request`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: `Request with id "${requestId}" has expired`
        })
      }

      const outcomeMessage = requestOperations.toOutcomeResponse(requestId, msg)
      storage.setRequest(requestId, requestOperations.toPollingOutcomeRecord(request, outcomeMessage))
      logger.log(`[METHOD:${request.method}][RID:${request.requestId}][EXP:${request.expiration.getTime()}] Stored outcome for polling`)

      return res.sendStatus(200)
    })

    app.post(
      '/identities',
      authMiddleware({
        optional: false,
        onError: err => ({
          error: err.message,
          message: 'This endpoint requires a signed fetch request. See ADR-44.'
        }),
        verifyMetadataContent: metadata => metadata?.signer !== 'decentraland-kernel-scene'
      }),
      async (req: Request & DecentralandSignatureData) => {
        const res = req.res as Response
        identityLogger.log('Received a request to create identity')
        try {
          const { identity, isMobile } = validateIdentityRequest(req.body)

          if (!identity) {
            identityLogger.log('Received a request to create identity without AuthIdentity in body')
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: 'AuthIdentity is required in request body'
            })
          }

          let identitySender: string | undefined
          try {
            const authChainValidation = await authChain.validateAuthChain(identity.authChain)
            identitySender = authChainValidation.sender
            identityOperations.assertEphemeralAddressMatchesFinalAuthority(identity, authChainValidation.finalAuthority)
            identityOperations.assertRequestSenderMatchesIdentityOwner(req.auth, identitySender)
            identityOperations.assertEphemeralPrivateKeyMatchesAddress(identity)
          } catch (e) {
            const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'

            if (errorMessage === 'Ephemeral wallet address does not match auth chain final authority') {
              identityLogger.log(
                `Ephemeral wallet address does not match auth chain final authority for sender: ${identitySender ?? 'unknown'}`
              )
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: errorMessage
              })
            }

            if (errorMessage === 'Request sender does not match identity owner') {
              identityLogger.log(`Request sender (${req.auth}) does not match identity owner (${identitySender ?? 'unknown'})`)
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: errorMessage
              })
            }

            if (errorMessage === 'Ephemeral private key does not match the provided address') {
              identityLogger.log(`Ephemeral private key does not match the provided address for sender: ${identitySender ?? 'unknown'}`)
              return sendResponse<InvalidResponseMessage>(res, 403, {
                error: errorMessage
              })
            }

            identityLogger.log(`Received a request to create identity with invalid auth chain: ${errorMessage}`)
            return sendResponse<InvalidResponseMessage>(res, 400, {
              error: errorMessage
            })
          }

          const identityId = uuid()
          const clientIp = ipUtils.getClientIp({
            headers: req.headers as IpHeaders,
            ip: req.ip,
            remoteAddress: req.socket.remoteAddress
          })
          const storageIdentity = identityOperations.buildStorageIdentity({
            identityId,
            identity,
            clientIp,
            isMobile
          })
          storage.setIdentity(identityId, storageIdentity)

          identityLogger.log(
            `[IID:${identityId}][EXP:${storageIdentity.expiration.getTime()}][Mobile:${
              storageIdentity.isMobile === true
            }] Successfully created identity from IP: ${clientIp}. Headers: ${ipUtils.formatIpHeaders(req.headers as IpHeaders)}`
          )

          sendResponse<IdentityResponse>(res, 201, {
            identityId,
            expiration: storageIdentity.expiration
          })
        } catch (e) {
          const errorMessage = isErrorWithMessage(e) ? e.message : 'Unknown error'
          identityLogger.log(`Received a request to create identity with invalid message: ${errorMessage}`)
          return sendResponse<InvalidResponseMessage>(res, 400, {
            error: errorMessage
          })
        }
      }
    )

    app.get('/identities/:id', async (req: Request, res: Response) => {
      const identityId = getPathParam(req.params.id)
      identityLogger.log(`Received a request to retrieve identity: ${identityId}`)

      if (!validateIdentityId(identityId)) {
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve identity with invalid format`)
        return sendResponse<InvalidResponseMessage>(res, 400, {
          error: 'Invalid identity format'
        })
      }

      const identity = await storage.getIdentity(identityId)

      if (!identity) {
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve a non-existent identity`)
        return sendResponse<InvalidResponseMessage>(res, 404, {
          error: 'Identity not found'
        })
      }

      if (identityOperations.isIdentityExpired(identity)) {
        storage.deleteIdentity(identityId)
        identityLogger.log(`[IID:${identityId}] Received a request to retrieve an expired identity`)
        return sendResponse<InvalidResponseMessage>(res, 410, {
          error: 'Identity has expired'
        })
      }

      const clientIp = ipUtils.getClientIp({
        headers: req.headers as IpHeaders,
        ip: req.ip,
        remoteAddress: req.socket.remoteAddress
      })
      const ipAccessValidation = identityOperations.validateIdentityIpAccess({
        identity,
        clientIp,
        ipsMatchFn: ipUtils.ipsMatch
      })

      if (ipAccessValidation.ok && ipAccessValidation.mobileMismatch) {
        identityLogger.log(
          `[IID:${identityId}] Mobile IP mismatch (allowed). Stored: ${
            identity.ipAddress
          }, Request: ${clientIp}. Headers: ${ipUtils.formatIpHeaders(req.headers as IpHeaders)}`
        )
      } else if (!ipAccessValidation.ok) {
        storage.deleteIdentity(identityId)
        identityLogger.log(
          `[IID:${identityId}] Received a request to retrieve identity from different IP. Stored: ${identity.ipAddress}, Request: ${clientIp}. Identity deleted.`
        )
        return sendResponse<InvalidResponseMessage>(res, 403, {
          error: 'IP address mismatch'
        })
      }

      try {
        storage.deleteIdentity(identityId)

        identityLogger.log(`[IID:${identityId}][EXP:${identity.expiration.getTime()}] Successfully served identity to IP: ${clientIp}`)

        sendResponse<IdentityIdValidationResponse>(res, 200, {
          identity: identity.identity
        })
      } catch (error) {
        const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown error'
        identityLogger.error(`[IID:${identityId}] Error serving identity: ${errorMessage}`)
        return sendResponse<InvalidResponseMessage>(res, 500, {
          error: 'Internal server error'
        })
      }
    })

    app.get(metricsPath, async (req: Request, res: Response) => {
      if (metricsBearerToken) {
        const authHeader = req.headers['authorization']
        if (!authHeader) {
          res.sendStatus(401)
          return
        }
        const [, token] = authHeader.split(' ')
        if (token !== metricsBearerToken) {
          res.sendStatus(401)
          return
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (metrics as any).registry
      if (!registry) {
        res.sendStatus(500)
        return
      }

      const body = await registry.metrics()
      res.set('content-type', registry.contentType)
      res.status(200).send(body)
    })

    server = app.listen(port)
    logger.log(`Listening on port ${port}`)
  }

  const stop: IBaseComponent['stop'] = async () => {
    if (!server) {
      return
    }

    logger.log('Stopping HTTP server...')
    await new Promise<void>(resolve => {
      server?.close(() => resolve())
    })
    server = null
  }

  return {
    start,
    stop
  }
}
