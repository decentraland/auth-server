import { createJobComponent } from '@dcl/job-component'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types/components'
import { INudgeJobComponent } from './types'

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

export function createNudgeJobComponent({
  onboarding,
  email,
  slack,
  logs,
  config
}: Pick<AppComponents, 'onboarding' | 'email' | 'slack' | 'logs' | 'config'>): INudgeJobComponent {
  const logger = logs.getLogger('nudge-job')

  let slackChannel: string | undefined

  const getSlackChannel = async (): Promise<string | undefined> => {
    if (slackChannel !== undefined) return slackChannel || undefined
    slackChannel = (await config.getString('SLACK_NUDGE_CHANNEL')) ?? ''
    return slackChannel || undefined
  }

  const notifySlack = async (nudge: { userId: string; checkpointId: number; email: string }, sequence: number): Promise<void> => {
    const channel = await getSlackChannel()
    if (!channel) return

    try {
      await slack.sendMessage({
        channel,
        text: `Onboarding nudge sent — user stuck at CP${nudge.checkpointId}, sending nudge email seq ${sequence} to ${nudge.email}`
      })
    } catch (e) {
      logger.warn(`Failed to send Slack notification: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    }
  }

  const runEvaluator = async (): Promise<void> => {
    logger.log('Running nudge evaluator...')

    for (const sequence of [1, 2, 3] as const) {
      let pendingNudges
      try {
        pendingNudges = await onboarding.getPendingNudges(sequence)
      } catch (e) {
        logger.error(`Failed to fetch pending nudges for sequence ${sequence}: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
        continue
      }

      logger.log(`[SEQ:${sequence}] Found ${pendingNudges.length} pending nudges`)

      for (const nudge of pendingNudges) {
        try {
          const messageId = await email.sendNudge({
            to: nudge.email,
            checkpointId: nudge.checkpointId,
            sequence
          })

          await onboarding.markNudgeSent(nudge.userId, nudge.checkpointId, sequence, messageId)
          void notifySlack(nudge, sequence)
        } catch (e) {
          logger.error(
            `[CP:${nudge.checkpointId}][USER:${nudge.userId}][SEQ:${sequence}] Failed to process nudge: ${
              isErrorWithMessage(e) ? e.message : 'Unknown error'
            }`
          )
          // Continue processing remaining nudges even if one fails
        }
      }
    }

    logger.log('Nudge evaluator finished')
  }

  const job = createJobComponent({ logs }, () => runEvaluator(), FIFTEEN_MINUTES_MS, {
    onError: (error: unknown) => {
      logger.error(`Unexpected error in nudge evaluator: ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`)
    }
  })

  return {
    ...job,
    runEvaluator
  }
}
