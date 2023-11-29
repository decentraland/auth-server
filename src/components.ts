import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { instrumentHttpServerWithRequestLogger } from '@well-known-components/http-requests-logger-component'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createHttpTracerComponent } from '@well-known-components/http-tracer-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { metricDeclarations } from './metrics'
import { createSocketComponent } from './ports/socket/component'
import { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const metrics = await createMetricsComponent(metricDeclarations, { config })

  const tracer = createTracerComponent()

  const logs = await createLogComponent({ metrics })

  const cors = { origin: await config.requireString('CORS_ORIGIN'), methods: await config.requireString('CORS_METHODS') }

  const httpServer = await createServerComponent<GlobalContext>({ config, logs }, { cors })

  createHttpTracerComponent({ server: httpServer, tracer })

  instrumentHttpServerWithRequestLogger({ server: httpServer, logger: logs })

  await instrumentHttpServerWithMetrics({ metrics, config, server: httpServer })

  const statusChecks = await createStatusCheckComponent({ server: httpServer, config })

  const webSocketServer = await createSocketComponent({ config, logs }, { cors })

  return {
    config,
    logs,
    httpServer,
    statusChecks,
    metrics,
    webSocketServer
  }
}
