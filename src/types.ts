import type { ICacheStorageComponent, IFetchComponent, IHttpServerComponent } from '@dcl/core-commons'
import type { IFeaturesComponent } from '@dcl/features-component'
import type { ISlackComponent } from '@dcl/slack-component'
import type { IFeatureFlagsAdapter } from './adapters/feature-flags'
import type { IMagicAdapter } from './adapters/magic'
import type { ITenderlyAdapter } from './adapters/tenderly'
import type { IAccountDeletionComponent } from './logic/account-deletion'
import type { ISimulationComponent } from './logic/simulation'
import type { ISocketServerComponent } from './logic/socket-server'
import type { metricDeclarations } from './metrics'
import type { IPgComponent } from './ports/db/types'
import type { IEmailComponent } from './ports/email/types'
import type { INudgeJobComponent } from './ports/nudge-job/types'
import type { IOnboardingComponent } from './ports/onboarding/types'
import type { IRateLimiterComponent } from './ports/rate-limiter'
import type { IStorageComponent } from './ports/storage/types'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent, ITracerComponent } from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  fetch: IFetchComponent
  features: IFeaturesComponent
  featureFlags: IFeatureFlagsAdapter
  magic: IMagicAdapter
  tenderly: ITenderlyAdapter
  accountDeletion: IAccountDeletionComponent
  simulation: ISimulationComponent
  rateLimiter: IRateLimiterComponent
  nudgeJob: INudgeJobComponent
  db: IPgComponent
  email: IEmailComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  onboarding: IOnboardingComponent
  server: IHttpServerComponent<GlobalContext>
  socketServer: ISocketServerComponent
  slack: ISlackComponent
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

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof BaseComponents,
  Path extends string = string
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<BaseComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = string> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>
