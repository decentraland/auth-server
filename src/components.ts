import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createServerComponent, createStatusCheckComponent, instrumentHttpServerWithPromClientRegistry } from '@dcl/http-server'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createMetricsComponent } from '@dcl/metrics'
import { createRedisComponent } from '@dcl/redis-component'
import { createSlackComponent } from '@dcl/slack-component'
import { createAuthChainComponent } from './logic/auth-chain'
import { createIdentityOperationsComponent } from './logic/identity-operations'
import { createIpUtilsComponent } from './logic/ip'
import { createRequestOperationsComponent } from './logic/request-operations'
import { metricDeclarations } from './metrics'
import { createPgComponent } from './ports/db/component'
import { createEmailComponent } from './ports/email/component'
import { createNudgeJobComponent } from './ports/nudge-job/component'
import { createOnboardingComponent } from './ports/onboarding/component'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents, GlobalContext } from './types/components'

function parseCorsOrigins(value: string): RegExp[] {
  // CORS_ORIGIN expects semicolon-separated regular expressions.
  return value.split(';').map(pattern => {
    try {
      return new RegExp(pattern)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Invalid CORS_ORIGIN regex "${pattern}": ${message}`)
    }
  })
}

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const redisHostUrl = await config.getString('REDIS_HOST')
  const cache = redisHostUrl ? await createRedisComponent(redisHostUrl, { logs }) : createInMemoryCacheComponent()
  const db = await createPgComponent({ config, logs, metrics }, {})
  const storage = createStorageComponent({ cache })
  const authChain = await createAuthChainComponent({ logs })
  const identityOperations = await createIdentityOperationsComponent({ logs })
  const ipUtils = await createIpUtilsComponent({ logs })
  const requestOperations = await createRequestOperationsComponent({ config })
  const onboarding = createOnboardingComponent({ db, logs })
  const email = await createEmailComponent({ config, logs })
  const slackToken = await config.getString('SLACK_BOT_TOKEN')
  const slack = createSlackComponent({ logs }, { token: slackToken ?? '' })
  const nudgeJob = createNudgeJobComponent({ onboarding, email, slack, logs, config })
  const corsMethods = (await config.requireString('CORS_METHODS'))
    .split(',')
    .map(method => method.trim())
    .filter(method => method.length > 0)
  const corsOrigin = parseCorsOrigins(await config.requireString('CORS_ORIGIN'))
  const server = await createServerComponent<GlobalContext>(
    {
      config,
      logs
    },
    {
      cors: {
        origin: corsOrigin,
        methods: corsMethods
      }
    }
  )
  const statusChecks = await createStatusCheckComponent({
    server,
    config
  })
  const metricsRegistry = metrics.registry
  if (!metricsRegistry) {
    throw new Error('Metrics registry is required to instrument HTTP server metrics')
  }
  await instrumentHttpServerWithPromClientRegistry({ config, metrics, registry: metricsRegistry, server })

  return {
    authChain,
    cache,
    config,
    db,
    email,
    identityOperations,
    ipUtils,
    logs,
    metrics,
    nudgeJob,
    onboarding,
    requestOperations,
    server,
    slack,
    statusChecks,
    storage,
    tracer
  }
}
