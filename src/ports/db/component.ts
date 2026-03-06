import path from 'path'
import { IBaseComponent } from '@well-known-components/interfaces'
import { createPgComponent as createBasePgComponent, Options } from '@well-known-components/pg-component'
import { PoolClient } from 'pg'
import { IPgComponent } from './types'

export async function createPgComponent(
  components: createBasePgComponent.NeededComponents,
  options: { migrations?: boolean } & Options = {}
): Promise<IPgComponent & IBaseComponent> {
  const { config, logs, metrics } = components
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

  const pg = await createBasePgComponent(
    { config, logs, metrics },
    {
      ...options,
      pool: {
        connectionString: databaseUrl,
        query_timeout: 40000,
        statement_timeout: 40000
      },
      ...(migrations
        ? {
            migration: {
              databaseUrl,
              ...(schema ? { schema } : {}),
              dir: path.resolve(__dirname, '../../migrations'),
              migrationsTable: 'pgmigrations',
              ignorePattern: '.*\\.map',
              direction: 'up'
            }
          }
        : {})
    }
  )

  async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>, onError?: (error: unknown) => Promise<void>): Promise<T> {
    const client = await pg.getPool().connect()

    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')

      return result
    } catch (error) {
      await client.query('ROLLBACK')
      if (onError) await onError(error)
      throw error
    } finally {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await client.release()
    }
  }

  return { ...pg, withTransaction }
}
