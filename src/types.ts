import type * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { metricDeclarations } from './metrics'
import { ISocketComponent } from './ports/socket/types'
import type {
  IBaseComponent,
  IConfigComponent,
  IFetchComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  httpServer: IHttpServerComponent<GlobalContext>
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  webSocketServer: ISocketComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  // Add components that are only used on runtime.
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // Add components that are only used on tests.
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<ComponentNames extends keyof AppComponents, Path extends string> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }> &
    authorizationMiddleware.DecentralandSignatureContext,
  Path
>
