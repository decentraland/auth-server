import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { DecentralandSignatureContext } from 'decentraland-crypto-middleware'
import type { AppComponents, GlobalContext } from '../types/components'

export type HandlerContext<Path extends string = string> = IHttpServerComponent.DefaultContext<
  IHttpServerComponent.PathAwareContext<GlobalContext, Path>
>

// This type simplifies the typings of http handlers, making component dependencies explicit
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = string
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<
    DecentralandSignatureContext & {
      components: Pick<AppComponents, ComponentNames>
    }
  >,
  Path
>
