import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { metricDeclarations } from './metrics'
import { createServerComponent } from './ports/server/component'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')
  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const cache = createInMemoryCacheComponent()
  const storage = createStorageComponent({ cache })
  const server = await createServerComponent({
    config,
    logs,
    metrics,
    storage,
    tracer,
    requestExpirationInSeconds,
    dclPersonalSignExpirationInSeconds
  })

  return {
    cache,
    config,
    logs,
    metrics,
    server,
    storage,
    tracer
  }
}
