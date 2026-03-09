import type {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent,
  ITracerComponent
} from '@well-known-components/interfaces'
import type { ICacheStorageComponent } from '@dcl/core-commons'
import type { AuthIdentity } from '@dcl/crypto'
import type { AuthChain } from '@dcl/schemas'
import type { DecentralandSignatureContext } from 'decentraland-crypto-middleware'
import type { ValidateAuthChainResult } from '../logic/auth-chain.types'
import type {
  BuildStorageIdentityParams,
  ValidateIdentityIpAccessParams,
  ValidateIdentityIpAccessResult
} from '../logic/identity-operations.types'
import type { GetClientIpInput, IpHeaders } from '../logic/ip.types'
import type {
  BuildRequestRecordParams,
  ComputeRequestExpirationParams,
  ToFulfilledRequestRecordParams
} from '../logic/request-operations.types'
import type { metricDeclarations } from '../metrics'
import type { HttpOutcomeMessage, IServerComponent, OutcomeResponseMessage, RecoverResponseMessage } from '../ports/server/types'
import type { IStorageComponent, StorageIdentity, StorageRequest } from '../ports/storage/types'

export type GlobalContext = DecentralandSignatureContext & {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  authChain: IAuthChainComponent
  config: IConfigComponent
  identityOperations: IIdentityOperationsComponent
  ipUtils: IIpUtilsComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<Extract<keyof typeof metricDeclarations, string>>
  requestOperations: IRequestOperationsComponent
  server: IServerComponent<GlobalContext>
  statusChecks: IBaseComponent
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

export interface IAuthChainComponent {
  validateAuthChain: (authChain: AuthChain) => Promise<ValidateAuthChainResult>
}

export interface IIpUtilsComponent {
  getIpHeaders: (request: IHttpServerComponent.IRequest) => IpHeaders
  normalizeIp: (ip: string) => string
  getClientIp: (input: GetClientIpInput) => string
  ipsMatch: (ip1: string, ip2: string) => boolean
  formatIpHeaders: (headers: IpHeaders) => string
}

export interface IRequestOperationsComponent {
  computeRequestExpiration: (params: ComputeRequestExpirationParams) => Date
  buildRequestRecord: (params: BuildRequestRecordParams) => StorageRequest
  isRequestExpired: (request: Pick<StorageRequest, 'expiration'>, now?: Date) => boolean
  toRecoverResponse: (request: Pick<StorageRequest, 'expiration' | 'code' | 'method' | 'params' | 'sender'>) => RecoverResponseMessage
  toOutcomeResponse: (requestId: string, outcome: HttpOutcomeMessage) => OutcomeResponseMessage
  toFulfilledRequestRecord: (params: ToFulfilledRequestRecordParams) => StorageRequest
  toPollingOutcomeRecord: (request: StorageRequest, outcome: OutcomeResponseMessage) => StorageRequest
}

export interface IIdentityOperationsComponent {
  assertEphemeralAddressMatchesFinalAuthority: (identity: AuthIdentity, finalAuthority: string) => void
  assertRequestSenderMatchesIdentityOwner: (requestSender: string | undefined, identitySender: string) => void
  assertEphemeralPrivateKeyMatchesAddress: (identity: AuthIdentity) => void
  validateIdentityChain: (identity: AuthIdentity, authChainResult: ValidateAuthChainResult, requestSender?: string) => string
  buildStorageIdentity: (params: BuildStorageIdentityParams) => StorageIdentity
  isIdentityExpired: (identity: Pick<StorageIdentity, 'expiration'>, now?: Date) => boolean
  validateIdentityIpAccess: (params: ValidateIdentityIpAccessParams) => ValidateIdentityIpAccessResult
}
