import { PoolClient } from 'pg'
import { createJobComponent } from '@dcl/job-component'
import { isErrorWithMessage } from '../../logic/error-handling'
import { AppComponents } from '../../types'
import { AnalyticsEvent } from '../../types/analytics'
import { INudgeJobComponent } from './types'

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

// Stable lock id chosen so it doesn't collide with other advisory locks the
// app might use. Picked from a generated random int32 — keep it constant.
const NUDGE_JOB_LOCK_ID = 731923741

export function createNudgeJobComponent({
  onboarding,
  email,
  slack,
  logs,
  config,
  featureFlags,
  analytics,
  db
}: Pick<AppComponents, 'onboarding' | 'email' | 'slack' | 'logs' | 'config' | 'featureFlags' | 'analytics' | 'db'>): INudgeJobComponent {
  const logger = logs.getLogger('nudge-job')

  let slackChannel: string | undefined

  const getSlackChannel = async (): Promise<string | undefined> => {
    if (slackChannel !== undefined) return slackChannel || undefined
    slackChannel = (await config.getString('SLACK_NUDGE_CHANNEL')) ?? ''
    return slackChannel || undefined
  }

  const notifySlack = async (nudge: { userId: string; email: string }, sequence: 1 | 2): Promise<void> => {
    const channel = await getSlackChannel()
    if (!channel) return

    try {
      await slack.sendMessage({
        channel,
        text: `Onboarding nudge sent — user authenticated but not in-world, sending nudge email seq ${sequence} to ${nudge.email}`
      })
    } catch (e) {
      logger.warn(`Failed to send Slack notification: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    }
  }

  /**
   * Acquires a Postgres session-scoped advisory lock on a DEDICATED pool
   * client. Returns the client (caller must release it via `releaseLock`)
   * on success, or `null` if another job already holds the lock.
   *
   * Why a dedicated client: `pg_try_advisory_lock` is bound to the connection
   * that ran it. The default `db.query()` uses any connection from the pool,
   * so an unlock issued via `db.query()` would land on a different connection
   * and silently no-op while the lock leaks on the original. Holding one
   * client throughout the run keeps the lock and the unlock on the same
   * connection. The rest of the job continues to use `db.query()` normally —
   * the dedicated client is only used to keep the lock alive.
   */
  const tryAcquireLock = async (): Promise<PoolClient | null> => {
    let client: PoolClient
    try {
      client = await db.getPool().connect()
    } catch (e) {
      logger.error(`Failed to acquire connection for nudge-job lock: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
      return null
    }

    try {
      const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1) AS acquired', [NUDGE_JOB_LOCK_ID])
      if (result.rows[0]?.acquired !== true) {
        client.release()
        return null
      }
      return client
    } catch (e) {
      client.release()
      logger.error(`Failed to acquire nudge-job advisory lock: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
      return null
    }
  }

  const releaseLock = async (client: PoolClient): Promise<void> => {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [NUDGE_JOB_LOCK_ID])
    } catch (e) {
      logger.warn(`Failed to release nudge-job advisory lock: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
    } finally {
      client.release()
    }
  }

  const runEvaluator = async (): Promise<void> => {
    if (!featureFlags.isNudgeEmailEnabled()) {
      logger.log('Nudge emails disabled by feature flag, skipping evaluator')
      return
    }

    const lockClient = await tryAcquireLock()
    if (!lockClient) {
      logger.log('Another nudge-job run holds the advisory lock — skipping this run')
      return
    }

    try {
      const whitelist = featureFlags.getNudgeEmailWhitelist()

      logger.log('Running nudge evaluator...', whitelist ? { whitelist: whitelist.join(', ') } : {})

      for (const sequence of [1, 2] as const) {
        let pendingNudges
        try {
          pendingNudges = await onboarding.getPendingNudges(sequence)
        } catch (e) {
          logger.error(`Failed to fetch pending nudges for sequence ${sequence}: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`)
          continue
        }

        if (whitelist) {
          pendingNudges = pendingNudges.filter(n => whitelist.includes(n.email.toLowerCase()))
        }

        logger.log(`[SEQ:${sequence}] Found ${pendingNudges.length} pending nudges`)

        for (const nudge of pendingNudges) {
          try {
            const result = await email.sendNudge({ to: nudge.email, sequence })

            if (result.ok) {
              analytics.fireEvent(AnalyticsEvent.NUDGE_EMAIL_SENT, {
                user_id: nudge.userId,
                email: nudge.email,
                sequence,
                template_id: result.templateId,
                sendgrid_message_id: result.messageId,
                sent_at: new Date().toISOString()
              })
              await onboarding.markNudgeSent(nudge.userId, sequence, result.messageId)
              void notifySlack(nudge, sequence)
            } else {
              analytics.fireEvent(AnalyticsEvent.NUDGE_EMAIL_FAILED, {
                user_id: nudge.userId,
                email: nudge.email,
                sequence,
                template_id: result.templateId,
                error: result.error,
                failed_at: new Date().toISOString()
              })
            }
          } catch (e) {
            logger.error(
              `[USER:${nudge.userId}][SEQ:${sequence}] Failed to process nudge: ${isErrorWithMessage(e) ? e.message : 'Unknown error'}`
            )
          }
        }
      }

      logger.log('Nudge evaluator finished')
    } finally {
      await releaseLock(lockClient)
    }
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
