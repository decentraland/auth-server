// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment
import path from 'node:path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { instrumentHttpServerWithRequestLogger, Verbosity } from '@well-known-components/http-requests-logger-component'
import { createServerComponent } from '@well-known-components/http-server'
import { ILoggerComponent, ITracerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { createSubgraphComponent, ISubgraphComponent } from '@well-known-components/thegraph-component'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { metricDeclarations } from '../src/metrics'
import { createAccessComponent, IAccessComponent } from '../src/ports/access'
import { createFetchComponent } from '../src/ports/fetch'
import { createItemsComponent, IItemsComponent } from '../src/ports/items'
import { createListsComponent, IListsComponents } from '../src/ports/lists'
import { createPgComponent, IPgComponent } from '../src/ports/pg'
import { createPicksComponent, IPicksComponent } from '../src/ports/picks'
import { createSchemaValidatorComponent } from '../src/ports/schema-validator'
import { createSnapshotComponent, ISnapshotComponent } from '../src/ports/snapshot'
import { main } from '../src/service'
import { GlobalContext, TestComponents } from '../src/types'

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
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const tracer = createTracerComponent()
  const logs = await createLogComponent({ metrics, tracer })

  const databaseUrl = (await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')) || ''
  const schema = await config.requireString('PG_COMPONENT_PSQL_SCHEMA')

  const pg = await createPgComponent(
    { logs, config, metrics },
    {
      migration: {
        databaseUrl,
        schema,
        dir: path.resolve(__dirname, '../src/migrations'),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  const server = await createServerComponent<GlobalContext>({ config, logs }, {})
  const fetch = await createFetchComponent({ tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs }, { verbosity: Verbosity.INFO })
  const COLLECTIONS_SUBGRAPH_URL = await config.requireString('COLLECTIONS_SUBGRAPH_URL')
  const collectionsSubgraph = await createSubgraphComponent({ logs, config, fetch, metrics }, COLLECTIONS_SUBGRAPH_URL)
  const snapshot = await createSnapshotComponent({ fetch, config })
  const schemaValidator = await createSchemaValidatorComponent()
  const items = createItemsComponent({ collectionsSubgraph, logs })
  const lists = createListsComponent({
    pg,
    items,
    snapshot,
    logs
  })
  const access = createAccessComponent({ pg, logs, lists })
  const picks = createPicksComponent({ pg, items, snapshot, logs, lists })

  return {
    config,
    snapshot,
    metrics,
    logs,
    pg,
    schemaValidator,
    server,
    fetch,
    lists,
    picks,
    collectionsSubgraph,
    localFetch: await createLocalFetchCompoment(config),
    access,
    items
  }
}

export function createTestLogsComponent({ getLogger = jest.fn() } = { getLogger: jest.fn() }): ILoggerComponent {
  return {
    getLogger
  }
}

export function createTestPicksComponent(
  { getPicksStats = jest.fn(), getPicksByItemId = jest.fn(), pickAndUnpickInBulk = jest.fn() } = {
    getPicksStats: jest.fn(),
    getPicksByItemId: jest.fn(),
    pickAndUnpickInBulk: jest.fn()
  }
): IPicksComponent {
  return {
    getPicksStats,
    getPicksByItemId,
    pickAndUnpickInBulk
  }
}

export function createTestSnapshotComponent({ getScore = jest.fn() } = { getScore: jest.fn() }): ISnapshotComponent {
  return {
    getScore
  }
}

export function createTestListsComponent(
  {
    getPicksByListId = jest.fn(),
    addPickToList = jest.fn(),
    deletePickInList = jest.fn(),
    getLists = jest.fn(),
    addList = jest.fn(),
    deleteList = jest.fn(),
    getList = jest.fn(),
    updateList = jest.fn(),
    checkNonEditableLists = jest.fn()
  } = {
    getPicksByListId: jest.fn(),
    addPickToList: jest.fn(),
    deletePickInList: jest.fn(),
    getLists: jest.fn(),
    addList: jest.fn(),
    deleteList: jest.fn(),
    updateList: jest.fn(),
    getList: jest.fn()
  }
): IListsComponents {
  return {
    getPicksByListId,
    addPickToList,
    deletePickInList,
    getLists,
    addList,
    deleteList,
    getList,
    updateList,
    checkNonEditableLists
  }
}

export function createTestAccessComponent(
  { deleteAccess = jest.fn(), createAccess = jest.fn() } = { deleteAccess: jest.fn(), createAccess: jest.fn() }
): IAccessComponent {
  return {
    createAccess,
    deleteAccess
  }
}

export function createTestItemsComponent({ validateItemExists = jest.fn() }): IItemsComponent {
  return {
    validateItemExists
  }
}

export function createTestSubgraphComponent({ query = jest.fn() } = { query: jest.fn() }): ISubgraphComponent {
  return {
    query
  }
}

export function createTestPgComponent(
  { query = jest.fn(), start = jest.fn(), streamQuery = jest.fn(), getPool = jest.fn(), stop = jest.fn(), withTransaction = jest.fn() } = {
    query: jest.fn(),
    start: jest.fn(),
    streamQuery: jest.fn(),
    getPool: jest.fn(),
    stop: jest.fn(),
    withTransaction: jest.fn()
  }
): IPgComponent {
  return {
    start,
    streamQuery,
    query,
    getPool,
    stop,
    withTransaction
  }
}

export function createTestTracerComponent(
  {
    span = jest.fn(),
    isInsideOfTraceSpan = jest.fn(),
    getSpanId = jest.fn(),
    getTrace = jest.fn(),
    getTraceString = jest.fn(),
    getTraceChild = jest.fn(),
    getTraceChildString = jest.fn(),
    getTraceState = jest.fn(),
    getTraceStateString = jest.fn(),
    getContextData = jest.fn(),
    setContextData = jest.fn(),
    setTraceStateProperty = jest.fn(),
    deleteTraceStateProperty = jest.fn()
  } = {
    span: jest.fn(),
    isInsideOfTraceSpan: jest.fn(),
    getSpanId: jest.fn(),
    getTrace: jest.fn(),
    getTraceString: jest.fn(),
    getTraceChild: jest.fn(),
    getTraceChildString: jest.fn(),
    getTraceState: jest.fn(),
    getTraceStateString: jest.fn(),
    getContextData: jest.fn(),
    setContextData: jest.fn(),
    setTraceStateProperty: jest.fn(),
    deleteTraceStateProperty: jest.fn()
  }
): ITracerComponent {
  return {
    span,
    isInsideOfTraceSpan,
    getSpanId,
    getTrace,
    getTraceString,
    getTraceChild,
    getTraceChildString,
    getTraceState,
    getTraceStateString,
    getContextData,
    setContextData,
    setTraceStateProperty,
    deleteTraceStateProperty
  }
}
