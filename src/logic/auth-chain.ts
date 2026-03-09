import { Authenticator, parseEmphemeralPayload } from '@dcl/crypto'
import { AuthLinkType, type AuthChain } from '@dcl/schemas'
import type { AppComponents, IAuthChainComponent } from '../types/components'
import { EphemeralKeyExpiredError } from './errors'
import type { ValidateAuthChainResult } from './auth-chain.types'

const EPHEMERAL_LINK_TYPES = new Set<string>([AuthLinkType.ECDSA_PERSONAL_EPHEMERAL, AuthLinkType.ECDSA_EIP_1654_EPHEMERAL])

export async function createAuthChainComponent({ logs }: Pick<AppComponents, 'logs'>): Promise<IAuthChainComponent> {
  const logger = logs.getLogger('auth-chain-component')

  const getEphemeralAddress = (payload: string): string => {
    try {
      return parseEmphemeralPayload(payload).ephemeralAddress
    } catch {
      throw new Error('Could not get final authority from auth chain')
    }
  }

  const validateAuthChain = async (authChain: AuthChain): Promise<ValidateAuthChainResult> => {
    if (!authChain.length) {
      logger.log('Received empty auth chain')
      throw new Error('Auth chain is required')
    }

    const sender = Authenticator.ownerAddress(authChain)

    const ephemeralLink = authChain.find(link => EPHEMERAL_LINK_TYPES.has(link.type))

    if (!ephemeralLink) {
      logger.log('No ephemeral link found in auth chain')
      throw new Error('Could not get final authority from auth chain')
    }

    const finalAuthority = getEphemeralAddress(ephemeralLink.payload)

    const validationResult = await Authenticator.validateSignature(finalAuthority, authChain, null)

    if (!validationResult.ok) {
      if (validationResult.message?.includes('Ephemeral key expired')) {
        logger.log('Auth chain ephemeral key has expired')
        throw new EphemeralKeyExpiredError()
      }
      logger.log(`Auth chain signature validation failed: ${validationResult.message ?? 'Signature validation failed'}`)
      throw new Error(validationResult.message ?? 'Signature validation failed')
    }

    return { sender, finalAuthority }
  }

  return {
    validateAuthChain
  }
}
