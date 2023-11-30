import { Lifecycle } from '@well-known-components/interfaces'
import { AppComponents, TestComponents } from './types'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  // start ports: db, listeners, synchronizations, etc
  await program.startComponents()
}
