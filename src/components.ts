import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createServerComponent, createStatusCheckComponent, instrumentHttpServerWithPromClientRegistry } from '@dcl/http-server'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createMetricsComponent } from '@dcl/metrics'
import { createRedisComponent } from '@dcl/redis-component'
import { createAuthChainComponent } from './logic/auth-chain'
import { createIdentityOperationsComponent } from './logic/identity-operations'
import { createRequestOperationsComponent } from './logic/request-operations'
import { metricDeclarations } from './metrics'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents, GlobalContext } from './types/components'
import { createIpUtilsComponent } from './logic/ip'

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
  const storage = createStorageComponent({ cache })
  const authChain = await createAuthChainComponent({ logs })
  const identityOperations = await createIdentityOperationsComponent({ logs })
  const ipUtils = await createIpUtilsComponent({ logs })
  const requestOperations = await createRequestOperationsComponent({ config })
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
    identityOperations,
    ipUtils,
    logs,
    metrics,
    requestOperations,
    server,
    statusChecks,
    storage,
    tracer
  }
}
