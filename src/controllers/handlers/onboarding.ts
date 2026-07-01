import { isErrorWithMessage } from '../../logic/error-handling'
import { InvalidResponseMessage } from '../../ports/server/types'
import { validateCheckpointRequest } from '../../ports/server/validations'
import { HandlerContextWithPath } from '../../types'
import { parseJsonBody } from '../utils'

// POST /onboarding/checkpoint — record onboarding checkpoint event.
// Bearer auth is enforced by the bearerTokenMiddleware in the router.
export async function createCheckpointHandler(context: HandlerContextWithPath<'onboarding' | 'logs', '/onboarding/checkpoint'>) {
  const {
    components: { onboarding, logs },
    request
  } = context

  const onboardingLogger = logs.getLogger('onboarding-endpoint')

  const body = await parseJsonBody(request)

  let checkpointReq
  try {
    checkpointReq = validateCheckpointRequest(body)
  } catch (e) {
    const validationError = isErrorWithMessage(e) ? e.message : 'Unknown error'
    onboardingLogger.warn(`Checkpoint validation failed: ${validationError}`, {
      body: JSON.stringify(body)
    })
    return { status: 400, body: { error: validationError } satisfies InvalidResponseMessage }
  }

  try {
    await onboarding.recordCheckpoint({
      userIdentifier: checkpointReq.userIdentifier,
      identifierType: checkpointReq.identifierType,
      checkpointId: checkpointReq.checkpointId,
      action: checkpointReq.action,
      email: checkpointReq.email,
      wallet: checkpointReq.wallet,
      source: checkpointReq.source,
      metadata: checkpointReq.metadata
    })
  } catch (e) {
    onboardingLogger.error(
      `[CP:${checkpointReq.checkpointId}][USER:${checkpointReq.userIdentifier}] Failed to record checkpoint: ${
        isErrorWithMessage(e) ? e.message : 'Unknown error'
      }`
    )
    return { status: 500, body: { error: 'Internal server error' } satisfies InvalidResponseMessage }
  }

  return { status: 200, body: { success: true } }
}

// GET /onboarding/pending-nudges — nudge queue dashboard.
// Bearer auth is enforced by the bearerTokenMiddleware in the router.
export async function getPendingNudgesDashboardHandler(
  context: HandlerContextWithPath<'onboarding' | 'logs', '/onboarding/pending-nudges'>
) {
  const {
    components: { onboarding, logs }
  } = context

  try {
    const sequences = [1, 2, 3] as const
    const results: Record<string, { count: number; emails: string[] }> = {}

    for (const seq of sequences) {
      const nudges = await onboarding.getPendingNudges(seq)
      // Group by checkpoint
      const byCheckpoint = new Map<number, string[]>()
      for (const n of nudges) {
        const list = byCheckpoint.get(n.checkpointId) ?? []
        list.push(n.email)
        byCheckpoint.set(n.checkpointId, list)
      }
      for (const [cp, emails] of byCheckpoint) {
        results[`CP${cp} - seq ${seq}`] = { count: emails.length, emails }
      }
    }

    return { status: 200, body: results }
  } catch (e) {
    const logger = logs.getLogger('onboarding-admin')
    logger.error(`Failed to get pending nudges dashboard: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    return { status: 500, body: { error: 'Failed to query pending nudges' } }
  }
}
