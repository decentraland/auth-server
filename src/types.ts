import { IReferralComponent } from './ports/referral/types'
import { IServerComponent } from './ports/server/types'
import { IStorageComponent } from './ports/storage/types'
import type { IConfigComponent, ILoggerComponent, ITracerComponent } from '@well-known-components/interfaces'

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
}

// components used in runtime
export type AppComponents = BaseComponents & {
  referralServer: IReferralComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  referralServer: IReferralComponent
}
