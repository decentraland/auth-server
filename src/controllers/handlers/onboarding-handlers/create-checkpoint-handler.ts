import { isErrorWithMessage } from '../../../logic/error-handling'
import { validateCheckpointRequest } from '../../../logic/validations'
import type { InvalidResponseMessage } from '../../../ports/server/types'
import type { HandlerContextWithPath } from '../../types'

export async function createCheckpointHandler({
  components: { config, onboarding },
  request
}: HandlerContextWithPath<'config' | 'onboarding', '/onboarding/checkpoint'>) {
  const apiKey = await config.getString('ONBOARDING_API_KEY')
  const authHeader = request.headers.get('authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return {
      status: 401,
      body: { error: 'Unauthorized' } satisfies InvalidResponseMessage
    }
  }

  let payload
  try {
    payload = validateCheckpointRequest(await request.json())
  } catch (error) {
    return {
      status: 400,
      body: {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      } satisfies InvalidResponseMessage
    }
  }

  await onboarding.recordCheckpoint(payload)

  return {
    status: 200,
    body: { success: true }
  }
}
