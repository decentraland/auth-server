import { v4 as uuidv4 } from 'uuid'
import { Authenticator, AuthIdentity, IdentityType } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'

export type TestIdentity = {
  authChain: AuthIdentity
  realAccount: IdentityType
  ephemeralIdentity: IdentityType
}

export async function createTestIdentity(expirationMinutes = 10): Promise<TestIdentity> {
  const ephemeralIdentity = createUnsafeIdentity()
  const realAccount = createUnsafeIdentity()

  const authChain = await Authenticator.initializeAuthChain(realAccount.address, ephemeralIdentity, expirationMinutes, async message =>
    Authenticator.createSignature(realAccount, message)
  )

  return { authChain, realAccount, ephemeralIdentity }
}

export function generateRandomIdentityId(): string {
  return uuidv4()
}
