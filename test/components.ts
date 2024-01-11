// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import net from 'net'
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createRunner } from '@well-known-components/test-helpers'
import { createServerComponent } from '../src/ports/server/component'
import { createStorageComponent } from '../src/ports/storage/component'
import { main } from '../src/service'
import { TestComponents } from '../src/types'

type TestOverrides = {
  requestExpirationInSeconds?: number
  clearRequestsInSeconds?: number
}

/**
 * Finds an open port using the node net library.
 * It works by starting a server on a random port, saving the port, and stopping the server.
 * The saved port, which is now available, is returned.
 */
function findOpenPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(() => {
      const info = server.address() as { port: number }
      server.close(() => {
        resolve(info.port)
      })
    })
  })
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

/**
 * Allows providing certain overrides to the test components.
 */
export const testWithOverrides = (overrides: TestOverrides) =>
  createRunner<TestComponents>({
    main,
    initComponents: () => initComponents(overrides)
  })

async function initComponents(overrides: TestOverrides = {}): Promise<TestComponents> {
  const httpServerPort = await findOpenPort()

  const config = await createDotEnvConfigComponent(
    { path: [path.resolve(__dirname, '../.env.spec')] },
    { HTTP_SERVER_PORT: httpServerPort.toString() }
  )
  const logs = await createLogComponent({})

  const storage = createStorageComponent({
    clearRequestsInSeconds: overrides.clearRequestsInSeconds ?? 999 * 60 // 999 seconds (So they are not cleared on tests by default)
  })

  const server = await createServerComponent({
    config,
    logs,
    storage,
    requestExpirationInSeconds: overrides.requestExpirationInSeconds ?? 5 * 60 // 5 Minutes
  })

  return {
    config,
    logs,
    server,
    storage
  }
}
