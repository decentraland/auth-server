import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createWebSocketComponent } from './ports/webSocket/component'
import { AppComponents } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const logs = await createLogComponent({})
  const webSocket = await createWebSocketComponent({ config, logs })

  return {
    config,
    logs,
    webSocket
  }
}
