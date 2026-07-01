import { isErrorWithMessage } from '../../logic/error-handling'
import { HandlerContextWithPath } from '../../types'
import { parseJsonBody } from '../utils'

// POST /admin/onboarding/run-evaluator — run the nudge evaluator manually
// (same as what cron does every 15 min). Mounted only when ONBOARDING_ADMIN_ENABLED=true.
export async function runEvaluatorHandler(context: HandlerContextWithPath<'nudgeJob' | 'logs', '/admin/onboarding/run-evaluator'>) {
  const {
    components: { nudgeJob, logs }
  } = context

  const adminLogger = logs.getLogger('onboarding-admin')

  try {
    await nudgeJob.runEvaluator()
    return { status: 200, body: { success: true } }
  } catch (e) {
    adminLogger.error(`Failed to run evaluator: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    return { status: 500, body: { error: 'Failed to run evaluator' } }
  }
}

// POST /admin/onboarding/send-test-email — send a test nudge email directly (bypasses DB).
// Mounted only when ONBOARDING_ADMIN_ENABLED=true.
export async function sendTestEmailHandler(context: HandlerContextWithPath<'email' | 'logs', '/admin/onboarding/send-test-email'>) {
  const {
    components: { email, logs },
    request
  } = context

  const adminLogger = logs.getLogger('onboarding-admin')

  const { to, checkpointId, sequence } = (await parseJsonBody(request)) as {
    to?: string
    checkpointId?: number
    sequence?: number
  }

  if (!to || !checkpointId || !sequence) {
    return { status: 400, body: { error: 'Missing required fields: to, checkpointId, sequence' } }
  }

  if (sequence < 1 || sequence > 3) {
    return { status: 400, body: { error: 'sequence must be 1, 2, or 3' } }
  }

  if (checkpointId < 1 || checkpointId > 7) {
    return { status: 400, body: { error: 'checkpointId must be 1-7' } }
  }

  try {
    const messageId = await email.sendNudge({ to, checkpointId, sequence: sequence as 1 | 2 | 3 })
    return { status: 200, body: { success: true, messageId: messageId ?? null } }
  } catch (e) {
    adminLogger.error(`Failed to send test email: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    return { status: 500, body: { error: 'Failed to send email' } }
  }
}

// GET /admin/onboarding/pending-nudges/:sequence — list pending nudges for a given sequence.
// Mounted only when ONBOARDING_ADMIN_ENABLED=true.
export async function getPendingNudgesForSequenceHandler(
  context: HandlerContextWithPath<'onboarding' | 'logs', '/admin/onboarding/pending-nudges/:sequence'>
) {
  const {
    components: { onboarding, logs },
    params
  } = context

  const adminLogger = logs.getLogger('onboarding-admin')

  const sequence = parseInt(params.sequence, 10) as 1 | 2 | 3

  if (![1, 2, 3].includes(sequence)) {
    return { status: 400, body: { error: 'sequence must be 1, 2, or 3' } }
  }

  try {
    const nudges = await onboarding.getPendingNudges(sequence)
    return { status: 200, body: { sequence, count: nudges.length, nudges } }
  } catch (e) {
    adminLogger.error(`Failed to get pending nudges: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    return { status: 500, body: { error: 'Failed to query pending nudges' } }
  }
}
