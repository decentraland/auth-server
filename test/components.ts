// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createRunner } from '@well-known-components/test-helpers'
import { createServerComponent } from '../src/ports/server/component'
import { main } from '../src/service'
import { TestComponents } from '../src/types'

// start TCP port for listeners
const lastUsedPort = 19000 + parseInt(process.env.JEST_WORKER_ID || '1') * 1000

function getFreePort() {
  return lastUsedPort + 1
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
    HTTP_SERVER_PORT: (currentPort + 1).toString()
  }

  const config = await createDotEnvConfigComponent(
    { path: [path.resolve(__dirname, '../.env.default'), path.resolve(__dirname, '../.env.spec')] },
    defaultConfig
  )

  const logs = await createLogComponent({})

  const server = await createServerComponent({ config, logs })

  return {
    config,
    logs,
    server
  }
}
