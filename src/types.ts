import { IServerComponent } from './ports/server/types'
import { IStorageComponent } from './ports/storage/types'
import type { IConfigComponent, ILoggerComponent, ITracerComponent, IMetricsComponent } from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IServerComponent
  storage: IStorageComponent
  tracer: ITracerComponent
  metrics: IMetricsComponent<string>
}

// components used in runtime
export type AppComponents = BaseComponents & {
  // Add components that are only used on runtime.
}

// components used in tests
export type TestComponents = BaseComponents & {
  // Add components that are only used on tests.
}
