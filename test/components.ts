// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import net from "net"
import path from "node:path"
import { createDotEnvConfigComponent } from "@well-known-components/env-config-provider"
import { ILoggerComponent } from "@well-known-components/interfaces"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import { createTracerComponent } from "@well-known-components/tracer-component"
import { createServerComponent, createStatusCheckComponent, instrumentHttpServerWithPromClientRegistry } from "@dcl/http-server"
import { createInMemoryCacheComponent } from "@dcl/memory-cache-component"
import { createTestMetricsComponent } from "@dcl/metrics"
import type { ISlackComponent } from "@dcl/slack-component"
import { createAuthChainComponent } from "../src/logic/auth-chain"
import { createIdentityOperationsComponent } from "../src/logic/identity-operations"
import { createIpUtilsComponent } from "../src/logic/ip"
import { createRequestOperationsComponent } from "../src/logic/request-operations"
import { metricDeclarations } from "../src/metrics"
import { IPgComponent } from "../src/ports/db/types"
import { IEmailComponent } from "../src/ports/email/types"
import { createNudgeJobComponent } from "../src/ports/nudge-job/component"
import { createOnboardingComponent } from "../src/ports/onboarding/component"
import { createStorageComponent } from "../src/ports/storage/component"
import { main } from "../src/service"
import { GlobalContext, TestComponents } from "../src/types/components"

type TestOverrides = {
  requestExpirationInSeconds?: number
  dclPersonalSignExpirationInSeconds?: number
  metricsBearerToken?: string
}

function parseCorsOrigins(value: string): RegExp[] {
  return value.split(";").map(pattern => new RegExp(pattern))
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
    server.on("error", reject)
    server.listen(() => {
      const info = server.address() as { port: number }
      server.close(() => {
        resolve(info.port)
      })
    })
  })
}

/**
 * Creates a no-op DB component suitable for unit/integration tests that do not need a real DB.
 * Tests that need real DB behavior should mock this component methods.
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
 * Creates a no-op email component for tests - never actually sends emails.
 */
export function createMockEmailComponent(): IEmailComponent {
  return {
    sendNudge: jest.fn().mockResolvedValue("mock-sg-message-id"),
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
  const requestExpirationInSeconds = overrides.requestExpirationInSeconds ?? 5 * 60
  const dclPersonalSignExpirationInSeconds = overrides.dclPersonalSignExpirationInSeconds ?? 5 * 60

  const config = await createDotEnvConfigComponent(
    { path: [path.resolve(__dirname, "../.env.spec")] },
    {
      HTTP_SERVER_PORT: httpServerPort.toString(),
      CORS_ORIGIN: "https://test-*.org;https://test-*.zone",
      REQUEST_EXPIRATION_IN_SECONDS: requestExpirationInSeconds.toString(),
      DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS: dclPersonalSignExpirationInSeconds.toString(),
      ...(overrides.metricsBearerToken ? { WKC_METRICS_BEARER_TOKEN: overrides.metricsBearerToken } : {})
    }
  )

  const tracer = await createTracerComponent()
  const logs = await createLogComponent({ tracer })
  const metrics = createTestMetricsComponent(metricDeclarations)
  const cache = createInMemoryCacheComponent()
  const db = createMockDbComponent()
  const storage = createStorageComponent({ cache })
  const authChain = await createAuthChainComponent({ logs })
  const identityOperations = await createIdentityOperationsComponent({ logs })
  const ipUtils = await createIpUtilsComponent({ logs })
  const requestOperations = await createRequestOperationsComponent({ config })
  const onboarding = createOnboardingComponent({ db, logs })
  const email = createMockEmailComponent()
  const slack: ISlackComponent = {
    sendMessage: jest.fn().mockResolvedValue(undefined)
  } as unknown as ISlackComponent
  const nudgeJob = createNudgeJobComponent({ onboarding, email, slack, logs: createMockLogs(), config })
  const corsMethods = (await config.requireString("CORS_METHODS"))
    .split(",")
    .map(method => method.trim())
    .filter(method => method.length > 0)
  const corsOrigin = parseCorsOrigins(await config.requireString("CORS_ORIGIN"))
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
    throw new Error("Metrics registry is required to instrument HTTP server metrics")
  }
  await instrumentHttpServerWithPromClientRegistry({ config, metrics, registry: metricsRegistry, server })

  return {
    authChain,
    config,
    db,
    email,
    identityOperations,
    ipUtils,
    logs,
    metrics,
    nudgeJob,
    onboarding,
    requestOperations,
    server,
    slack,
    statusChecks,
    storage,
    tracer
  }
}
