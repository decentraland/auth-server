import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createServerComponent } from './ports/server/component'
import { createStorageComponent } from './ports/storage/component'
import { AppComponents } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const logs = await createLogComponent({})
  const storage = createStorageComponent()
  const server = await createServerComponent({
    config,
    logs,
    storage,
    // TODO: Get this value from config.
    requestExpirationInSeconds: 5 * 60 // 5 Minutes
  })

  return {
    config,
    logs,
    server,
    storage
  }
}
