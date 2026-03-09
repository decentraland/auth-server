import { v4 as uuid } from 'uuid'
import { isErrorWithMessage } from '../../../logic/error-handling'
import { validateRequestMessage } from '../../../logic/validations'
import { METHOD_DCL_PERSONAL_SIGN } from '../../../ports/server/constants'
import type { InvalidResponseMessage, RequestMessage, RequestResponseMessage } from '../../../ports/server/types'
import type { HandlerContextWithPath } from '../../types'

export async function createRequestHandler({
  components: { authChain, config, requestOperations, storage },
  request
}: HandlerContextWithPath<'authChain' | 'config' | 'requestOperations' | 'storage', '/requests'>) {
  let msg: RequestMessage

  try {
    msg = validateRequestMessage(await request.json())
  } catch (error) {
    return {
      status: 400,
      body: {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      } satisfies InvalidResponseMessage
    }
  }

  let sender: string | undefined

  if (msg.method !== METHOD_DCL_PERSONAL_SIGN) {
    try {
      const { sender: validatedSender } = await authChain.validateAuthChain(msg.authChain || [])
      sender = validatedSender
    } catch (error) {
      return {
        status: 400,
        body: {
          error: isErrorWithMessage(error) ? error.message : 'Unknown error'
        } satisfies InvalidResponseMessage
      }
    }
  }

  const requestExpirationInSeconds = await config.requireNumber('REQUEST_EXPIRATION_IN_SECONDS')
  const dclPersonalSignExpirationInSeconds = await config.requireNumber('DCL_PERSONAL_SIGN_REQUEST_EXPIRATION_IN_SECONDS')
  const requestId = uuid()
  const expiration = requestOperations.computeRequestExpiration({
    method: msg.method,
    requestExpirationInSeconds,
    dclPersonalSignExpirationInSeconds
  })
  const code = Math.floor(Math.random() * 100)

  await storage.setRequest(
    requestId,
    requestOperations.buildRequestRecord({
      requestId,
      expiration,
      code,
      method: msg.method,
      params: msg.params,
      sender
    })
  )

  return {
    status: 201,
    body: {
      requestId,
      expiration,
      code
    } satisfies RequestResponseMessage
  }
}
