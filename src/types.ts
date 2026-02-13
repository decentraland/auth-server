import type { ICacheStorageComponent } from '@dcl/core-commons'
import type { metricDeclarations } from './metrics'
import type { IServerComponent } from './ports/server/types'
import type { IStorageComponent } from './ports/storage/types'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent, ITracerComponent } from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  server: IServerComponent
  storage: IStorageComponent
  tracer: ITracerComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  cache: ICacheStorageComponent
  // Add components that are only used on runtime.
}

// components used in tests
export type TestComponents = BaseComponents & {
  // Add components that are only used on tests.
}
