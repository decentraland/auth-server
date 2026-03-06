import path from 'path'
import { IBaseComponent } from '@well-known-components/interfaces'
import { createPgComponent as createBasePgComponent, IPgComponent, Options } from '@dcl/pg-component'

type NeededComponents = Parameters<typeof createBasePgComponent>[0]

export async function createPgComponent(
  components: NeededComponents,
  options: { migrations?: boolean } & Options = {}
): Promise<IPgComponent & IBaseComponent> {
  const { config } = components
  const { migrations = true } = options

  let databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
  if (!databaseUrl) {
    const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
    const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
    const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
    const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
    const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')

    databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
  }

  const schema = await config.getString('PG_COMPONENT_PSQL_SCHEMA')

  return createBasePgComponent(components, {
    ...options,
    pool: {
      connectionString: databaseUrl,
      query_timeout: 40000,
      statement_timeout: 40000
    },
    ...(migrations
      ? {
          migration: {
            ...(schema ? { schema } : {}),
            dir: path.resolve(__dirname, '../../migrations'),
            migrationsTable: 'pgmigrations',
            ignorePattern: '.*\\.map',
            direction: 'up'
          }
        }
      : {})
  })
}
