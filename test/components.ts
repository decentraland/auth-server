// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import net from 'net'
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createServerComponent, instrumentHttpServerWithPromClientRegistry } from '@dcl/http-server'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createTestMetricsComponent } from '@dcl/metrics'
import { ISlackComponent } from '@dcl/slack-component'
import { createRunner } from '@dcl/test-helpers'
import { createTracerComponent } from '@dcl/tracer-component'
import { IMagicAdapter } from '../src/adapters/magic'
import { createAccountDeletionComponent } from '../src/logic/account-deletion'
import { createSocketServerComponent } from '../src/logic/socket-server'
import { metricDeclarations } from '../src/metrics'
import { IPgComponent } from '../src/ports/db/types'
import { IEmailComponent } from '../src/ports/email/types'
import { createNudgeJobComponent } from '../src/ports/nudge-job/component'
import { createOnboardingComponent } from '../src/ports/onboarding/component'
import { MAX_BODY_SIZE_BYTES } from '../src/ports/server/constants'
import { createStorageComponent } from '../src/ports/storage/component'
import { main } from '../src/service'
import { GlobalContext, TestComponents } from '../src/types'

type TestOverrides = {
  requestExpirationInSeconds?: number
  dclPersonalSignExpirationInSeconds?: number
  didTokenMaxAgeSeconds?: number
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
 * Creates a mock Magic adapter. Tests control its behavior per-case via
 * `args.components.magic.validateDidToken` / `requestUserDeletion`.
 */
export function createMockMagicAdapter(): IMagicAdapter {
  return {
    validateDidToken: jest.fn(),
    requestUserDeletion: jest.fn().mockResolvedValue({ processed: [], unprocessed: [] })
  } as unknown as IMagicAdapter
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
    {
      HTTP_SERVER_PORT: httpServerPort.toString(),
      CORS_ORIGIN: 'https://test-*.org;https://test-*.zone',
      ACCOUNT_DELETION_ALLOWED_ORIGINS: 'https://account.decentraland.org',
      // Expiration values are read from config by both the HTTP request handlers and the
      // socket-server, so per-test overrides are injected here as config defaults.
      REQUEST_EXPIRATION_IN_SECONDS: String(overrides.requestExpirationInSeconds ?? 5 * 60), // 5 Minutes
      DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS: String(overrides.dclPersonalSignExpirationInSeconds ?? 5 * 60) // 5 Minutes
    }
  )

  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = createTestMetricsComponent(metricDeclarations)
  const cache = createInMemoryCacheComponent()
  const db = createMockDbComponent()
  const storage = createStorageComponent({ cache })
  const onboarding = createOnboardingComponent({ db, logs })
  const magic = createMockMagicAdapter()
  const accountDeletion = createAccountDeletionComponent({
    magic,
    storage,
    logs,
    didTokenMaxAgeSeconds: overrides.didTokenMaxAgeSeconds ?? 120
  })
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

  const cors = {
    origin: (await config.requireString('CORS_ORIGIN')).split(';').map(origin => new RegExp(origin)),
    methods: (await config.requireString('CORS_METHODS')).split(',')
  }

  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    {
      cors: { origin: cors.origin, methods: cors.methods },
      maxBodySize: MAX_BODY_SIZE_BYTES
    }
  )

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry })

  const socketServer = await createSocketServerComponent(
    { logs, storage, tracer, server },
    {
      requestExpirationInSeconds: overrides.requestExpirationInSeconds ?? 5 * 60, // 5 Minutes
      dclPersonalSignExpirationInSeconds: overrides.dclPersonalSignExpirationInSeconds ?? 5 * 60, // 5 Minutes
      cors: { origin: cors.origin, methods: await config.requireString('CORS_METHODS') }
    }
  )

  return {
    config,
    fetch,
    features,
    featureFlags,
    magic,
    accountDeletion,
    nudgeJob,
    db,
    email,
    tracer,
    logs,
    metrics,
    onboarding,
    server,
    socketServer,
    slack,
    storage
  }
}
