import { ISubgraphComponent } from '@well-known-components/thegraph-component'
import type * as authorizationMiddleware from 'decentraland-crypto-middleware'
import { PaginatedResponse } from './logic/http'
import { metricDeclarations } from './metrics'
import { IAccessComponent } from './ports/access'
import { IItemsComponent } from './ports/items'
import { IListsComponents } from './ports/lists/types'
import { IPgComponent } from './ports/pg'
import { IPicksComponent } from './ports/picks'
import { ISchemaValidatorComponent } from './ports/schema-validator'
import { ISnapshotComponent } from './ports/snapshot'
import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent,
  IDatabase
} from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  fetch: IFetchComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  pg: IPgComponent & IDatabase
  schemaValidator: ISchemaValidatorComponent
  lists: IListsComponents
  collectionsSubgraph: ISubgraphComponent
  snapshot: ISnapshotComponent
  picks: IPicksComponent
  access: IAccessComponent
  items: IItemsComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
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

export type Context<Path extends string = never> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export enum StatusCode {
  OK = 200,
  CREATED = 201,
  UPDATED = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  LOCKED = 423,
  CONFLICT = 409,
  ERROR = 500,
  UNPROCESSABLE_CONTENT = 422
}

export type HTTPResponse<T> = {
  status: StatusCode
  body:
    | {
        ok: false
        message: string
        data?: object
      }
    | {
        ok: true
        data?: PaginatedResponse<T>
      }
    | {
        ok: true
        data?: T
      }
}
