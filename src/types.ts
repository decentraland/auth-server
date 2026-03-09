import type { ICacheStorageComponent } from '@dcl/core-commons'
import type { metricDeclarations } from './metrics'
import type { IPgComponent } from './ports/db/types'
import type { IEmailComponent } from './ports/email/types'
import type { INudgeJobComponent } from './ports/nudge-job/types'
import type { IOnboardingComponent } from './ports/onboarding/types'
import type { IServerComponent } from './ports/server/types'
import type { IStorageComponent } from './ports/storage/types'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent, ITracerComponent } from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  nudgeJob: INudgeJobComponent
  db: IPgComponent
  email: IEmailComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  onboarding: IOnboardingComponent
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
