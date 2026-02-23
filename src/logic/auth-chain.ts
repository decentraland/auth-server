import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import type { AuthChain } from '@dcl/schemas'
import type { AppComponents, IAuthChainComponent } from '../types/components'
import type { ValidateAuthChainResult } from './auth-chain.types'

export async function createAuthChainComponent({ logs }: Pick<AppComponents, 'logs'>): Promise<IAuthChainComponent> {
  const logger = logs.getLogger('auth-chain-component')

  const validateAuthChain = async (authChain: AuthChain): Promise<ValidateAuthChainResult> => {
    if (!authChain.length) {
      logger.log('Received empty auth chain')
      throw new Error('Auth chain is required')
    }

    const sender = Authenticator.ownerAddress(authChain)

    let finalAuthority: string

    try {
      const ephemeralPayload = parseEmphemeralPayload(authChain[authChain.length - 1].payload)
      finalAuthority = ephemeralPayload.ephemeralAddress
    } catch (error) {
      if (error instanceof Error && error.message === 'Ephemeral payload has expired') {
        logger.log('Auth chain ephemeral payload has expired')
        throw error
      }

      logger.log('Could not parse final authority from auth chain payload')
      throw new Error('Could not get final authority from auth chain')
    }

    const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

    if (!validationResult.ok) {
      logger.log(`Auth chain signature validation failed: ${validationResult.message ?? 'Signature validation failed'}`)
      throw new Error(validationResult.message ?? 'Signature validation failed')
    }

    return { sender, finalAuthority }
  }

  return {
    validateAuthChain
  }
}
