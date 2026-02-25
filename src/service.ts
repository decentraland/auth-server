import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes'
import { AppComponents, GlobalContext, TestComponents } from './types/components'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components } = program
  const context: GlobalContext = {
    components
  }
  const router = setupRouter()

  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.setContext(context)

  // start ports: db, listeners, synchronizations, etc
  await program.startComponents()
}
