import { v4 as uuidv4 } from 'uuid'
import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'

export async function createTestIdentity(expirationMinutes = 10): Promise<AuthIdentity> {
  const ephemeralIdentity = createUnsafeIdentity()
  const realAccount = createUnsafeIdentity()

  const authIdentity = await Authenticator.initializeAuthChain(realAccount.address, ephemeralIdentity, expirationMinutes, async message =>
    Authenticator.createSignature(realAccount, message)
  )

  return authIdentity
}

export function generateRandomIdentityId(): string {
  return uuidv4()
}
