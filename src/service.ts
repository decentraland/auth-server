import { Lifecycle } from '@well-known-components/interfaces'
import {
  AppComponents,
  // TODO: Uncomment when required.
  // GlobalContext,
  TestComponents
} from './types'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const {
    // TODO: Uncomment when required.
    // components,
    // TODO: handle the following eslint-disable statement
    // eslint-disable-next-line @typescript-eslint/unbound-method
    startComponents
  } = program

  // TODO: Uncomment when required.
  // const globalContext: GlobalContext = { components }

  // start ports: db, listeners, synchronizations, etc
  await startComponents()
}
