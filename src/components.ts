import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createSocketComponent } from './ports/socket/component'
import { AppComponents } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const logs = await createLogComponent({})

  const cors = { origin: await config.requireString('CORS_ORIGIN'), methods: await config.requireString('CORS_METHODS') }

  const webSocketServer = await createSocketComponent({ config, logs }, { cors })

  return {
    config,
    logs,
    webSocketServer
  }
}
