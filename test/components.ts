// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createRunner } from '@well-known-components/test-helpers'
import { main } from '../src/service'
import { TestComponents } from '../src/types'

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
  // default config from process.env + .env file
  const defaultConfig = {
    // Add default config values here.
  }

  const config = await createDotEnvConfigComponent(
    { path: [path.resolve(__dirname, '../.env.default'), path.resolve(__dirname, '../.env.spec')] },
    defaultConfig
  )
  const logs = await createLogComponent({})

  return {
    config,
    logs
  }
}

export function createTestLogsComponent({ getLogger = jest.fn() } = { getLogger: jest.fn() }): ILoggerComponent {
  return {
    getLogger
  }
}
