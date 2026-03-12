// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import net from 'net'
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createRunner } from '@well-known-components/test-helpers'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { ISlackComponent } from '@dcl/slack-component'
import { metricDeclarations } from '../src/metrics'
import { IPgComponent } from '../src/ports/db/types'
import { IEmailComponent } from '../src/ports/email/types'
import { createNudgeJobComponent } from '../src/ports/nudge-job/component'
import { createOnboardingComponent } from '../src/ports/onboarding/component'
import { createServerComponent } from '../src/ports/server/component'
import { createStorageComponent } from '../src/ports/storage/component'
import { main } from '../src/service'
import { TestComponents } from '../src/types'

type TestOverrides = {
  requestExpirationInSeconds?: number
  dclPersonalSignExpirationInSeconds?: number
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
 * Creates a no-op DB component suitable for unit/integration tests that don't need a real DB.
 * Tests that need real DB behavior should mock this component's methods.
 */
export function createMockDbComponent(): IPgComponent {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, notices: [] }),
    getPool: jest.fn(),
    withTransaction: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  } as unknown as IPgComponent
}

/**
 * Creates a no-op email component for tests — never actually sends emails.
 */
export function createMockEmailComponent(): IEmailComponent {
  return {
    sendNudge: jest.fn().mockResolvedValue('mock-sg-message-id'),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined)
  } as unknown as IEmailComponent
}

function createMockLogs(): ILoggerComponent {
  const logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return { getLogger: () => logger } as unknown as ILoggerComponent
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
    { HTTP_SERVER_PORT: httpServerPort.toString(), CORS_ORIGIN: 'https://test-*.org;https://test-*.zone' }
  )

  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = createTestMetricsComponent(metricDeclarations)
  const cache = createInMemoryCacheComponent()
  const db = createMockDbComponent()
  const storage = createStorageComponent({ cache })
  const onboarding = createOnboardingComponent({ db, logs })
  const email = createMockEmailComponent()
  const slack: ISlackComponent = {
    sendMessage: jest.fn().mockResolvedValue(undefined)
  } as unknown as ISlackComponent
  const featureFlags = {
    isEnabled: jest.fn().mockReturnValue(true),
    getVariant: jest.fn().mockReturnValue(undefined),
    isNudgeEmailEnabled: jest.fn().mockReturnValue(true),
    getNudgeEmailWhitelist: jest.fn().mockReturnValue(undefined)
  } as unknown as TestComponents['featureFlags']
  const fetch = { fetch: jest.fn() } as unknown as TestComponents['fetch']
  const features = { getIsFeatureEnabled: jest.fn(), getFeatureVariant: jest.fn() } as unknown as TestComponents['features']
  const nudgeJob = createNudgeJobComponent({ onboarding, email, slack, logs: createMockLogs(), config, featureFlags })
  const server = await createServerComponent({
    config,
    logs,
    metrics,
    onboarding,
    email,
    nudgeJob,
    tracer,
    storage,
    requestExpirationInSeconds: overrides.requestExpirationInSeconds ?? 5 * 60, // 5 Minutes
    dclPersonalSignExpirationInSeconds: overrides.dclPersonalSignExpirationInSeconds ?? 5 * 60 // 5 Minutes
  })

  return {
    config,
    fetch,
    features,
    featureFlags,
    nudgeJob,
    db,
    email,
    tracer,
    logs,
    metrics,
    onboarding,
    server,
    slack,
    storage
  }
}
