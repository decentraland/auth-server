import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment.
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  // Add components that are only used on runtime.
}

// components used in tests
export type TestComponents = BaseComponents & {
  // Add components that are only used on tests.
}
