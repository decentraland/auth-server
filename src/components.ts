import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createFeaturesComponent } from '@dcl/features-component'
import { createFetchComponent } from '@dcl/fetch-component'
import { createServerComponent, instrumentHttpServerWithPromClientRegistry } from '@dcl/http-server'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createMetricsComponent } from '@dcl/metrics'
import { createRedisComponent } from '@dcl/redis-component'
import { createSlackComponent } from '@dcl/slack-component'
import { createTracerComponent } from '@dcl/tracer-component'
import { createFeatureFlagsAdapter } from './adapters/feature-flags'
import { createMagicAdapter } from './adapters/magic'
import { createAccountDeletionComponent } from './logic/account-deletion'
import { parseCorsOrigins } from './logic/cors'
import { createSocketServerComponent } from './logic/socket-server'
import { metricDeclarations } from './metrics'
import { createPgComponent } from './ports/db/component'
import { createEmailComponent } from './ports/email/component'
import { createNudgeJobComponent } from './ports/nudge-job/component'
import { createOnboardingComponent } from './ports/onboarding/component'
import { MAX_BODY_SIZE_BYTES } from './ports/server/constants'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')
  const didTokenMaxAgeSeconds = await config.requireNumber('MAGIC_DID_TOKEN_MAX_AGE_SECONDS')
  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })

  const cors = {
    origin: parseCorsOrigins(await config.requireString('CORS_ORIGIN')),
    methods: (await config.requireString('CORS_METHODS')).split(',')
  }

  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    {
      cors: {
        origin: cors.origin,
        methods: cors.methods
      },
      maxBodySize: MAX_BODY_SIZE_BYTES
    }
  )

  if (!metrics.registry) {
    throw new Error('Metrics registry is not available')
  }
  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry })

  const redisHostUrl = await config.getString('REDIS_HOST')
  const cache = redisHostUrl ? await createRedisComponent(redisHostUrl, { logs }) : createInMemoryCacheComponent()
  const db = await createPgComponent({ config, logs, metrics }, {})
  const storage = createStorageComponent({ cache })
  const fetch = createFetchComponent()
  const magic = await createMagicAdapter({ config, logs, fetch })
  const features = await createFeaturesComponent(
    { config, logs, fetch },
    (await config.getString('SERVICE_BASE_URL')) || 'https://auth-api.decentraland.org'
  )
  const featureFlags = createFeatureFlagsAdapter({ logs, features })
  const onboarding = createOnboardingComponent({ db, logs })
  const accountDeletion = createAccountDeletionComponent({ magic, storage, logs, didTokenMaxAgeSeconds })
  const email = await createEmailComponent({ config, logs })
  const slackToken = await config.getString('SLACK_BOT_TOKEN')
  const slack = createSlackComponent({ logs }, { token: slackToken ?? '' })
  const nudgeJob = createNudgeJobComponent({ onboarding, email, slack, logs, config, featureFlags })

  // socket.io server: attaches to the http-server's underlying Node http.Server on start
  // (after the http-server is listening) and owns the WebSocket protocol unchanged.
  const socketServer = await createSocketServerComponent(
    { logs, storage, tracer, server },
    {
      requestExpirationInSeconds,
      dclPersonalSignExpirationInSeconds,
      cors: { origin: cors.origin, methods: await config.requireString('CORS_METHODS') }
    }
  )

  return {
    cache,
    config,
    fetch,
    features,
    featureFlags,
    magic,
    accountDeletion,
    nudgeJob,
    db,
    email,
    logs,
    metrics,
    onboarding,
    server,
    socketServer,
    slack,
    storage,
    tracer
  }
}
