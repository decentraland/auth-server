import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { GlobalContext } from '../types/components'

export type HandlerContext<Path extends string = string> = IHttpServerComponent.DefaultContext<
  IHttpServerComponent.PathAwareContext<GlobalContext, Path>
>
