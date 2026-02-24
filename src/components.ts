import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createRedisComponent } from '@dcl/redis-component'
import { createAuthChainComponent } from './logic/auth-chain'
import { createIdentityOperationsComponent } from './logic/identity-operations'
import { createRequestOperationsComponent } from './logic/request-operations'
import { metricDeclarations } from './metrics'
import { createServerComponent } from './ports/server/server'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents } from './types/components'
import { createIpUtilsComponent } from './utils/ip'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')
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
  const server = await createServerComponent({
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
  })

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
    storage,
    tracer
  }
}
