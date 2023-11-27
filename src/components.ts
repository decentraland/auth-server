import path from 'path'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { instrumentHttpServerWithRequestLogger } from '@well-known-components/http-requests-logger-component'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createHttpTracerComponent } from '@well-known-components/http-tracer-component'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { createSubgraphComponent } from '@well-known-components/thegraph-component'
import { createTracerComponent } from '@well-known-components/tracer-component'
import { metricDeclarations } from './metrics'
import { createAccessComponent } from './ports/access'
import { createFetchComponent } from './ports/fetch'
import { createItemsComponent } from './ports/items'
import { createListsComponent } from './ports/lists/component'
import { createPgComponent } from './ports/pg'
import { createPicksComponent } from './ports/picks'
import { createSchemaValidatorComponent } from './ports/schema-validator'
import { createSnapshotComponent } from './ports/snapshot'
import { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env']
  })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const tracer = createTracerComponent()
  const logs = await createLogComponent({ metrics })

  let databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
  const COLLECTIONS_SUBGRAPH_URL = await config.requireString('COLLECTIONS_SUBGRAPH_URL')
  const cors = {
    origin: await config.requireString('CORS_ORIGIN'),
    methods: await config.requireString('CORS_METHODS')
  }

  if (!databaseUrl) {
    const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
    const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
    const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
    const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
    const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')

    databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
  }
  const schema = await config.requireString('PG_COMPONENT_PSQL_SCHEMA')

  const pg = await createPgComponent(
    { logs, config, metrics },
    {
      migration: {
        databaseUrl,
        schema,
        dir: path.resolve(__dirname, 'migrations'),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors })
  createHttpTracerComponent({ server, tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs })
  await instrumentHttpServerWithMetrics({ metrics, config, server })
  const schemaValidator = await createSchemaValidatorComponent()
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent({ tracer })
  const collectionsSubgraph = await createSubgraphComponent({ logs, config, fetch, metrics }, COLLECTIONS_SUBGRAPH_URL)
  const snapshot = await createSnapshotComponent({ fetch, config })
  const items = createItemsComponent({ logs, collectionsSubgraph })
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
    collectionsSubgraph,
    logs,
    server,
    statusChecks,
    fetch,
    metrics,
    pg,
    schemaValidator,
    lists,
    snapshot,
    picks,
    access,
    items
  }
}
