// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { instrumentHttpServerWithRequestLogger, Verbosity } from '@well-known-components/http-requests-logger-component'
import { createServerComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { metricDeclarations } from '../src/metrics'
import { createSocketComponent } from '../src/ports/socket/component'
import { main } from '../src/service'
import { GlobalContext, TestComponents } from '../src/types'

// start TCP port for listeners
const lastUsedPort = 19000 + parseInt(process.env.JEST_WORKER_ID || '1') * 1000

function getFreePort() {
  return lastUsedPort + 2
}

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const currentPort = getFreePort()

  // default config from process.env + .env file
  const defaultConfig = {
    HTTP_SERVER_PORT: (currentPort + 1).toString(),
    WEBSOCKET_SERVER_PORT: (currentPort + 2).toString()
  }

  const config = await createDotEnvConfigComponent(
    { path: [path.resolve(__dirname, '../.env.default'), path.resolve(__dirname, '../.env.spec')] },
    defaultConfig
  )
  const metrics = await createMetricsComponent(metricDeclarations, { config })

  const tracer = createTracerComponent()

  const logs = await createLogComponent({ metrics, tracer })

  const httpServer = await createServerComponent<GlobalContext>({ config, logs }, {})

  instrumentHttpServerWithRequestLogger({ server: httpServer, logger: logs }, { verbosity: Verbosity.INFO })

  const webSocketServer = await createSocketComponent({ config, logs }, {})

  const localFetch = await createLocalFetchCompoment(config)

  return {
    config,
    metrics,
    logs,
    httpServer,
    webSocketServer,
    localFetch
  }
}
