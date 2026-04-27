import SQL from 'sql-template-strings'
import { AppComponents } from '../../types'
import { CheckpointPayload, IOnboardingComponent, PendingNudge } from './types'

// Index 0 is unused — sequence IDs start at 1.
const SEQUENCE_HOURS = [0, 24, 72]

export function createOnboardingComponent({ db, logs }: Pick<AppComponents, 'db' | 'logs'>): IOnboardingComponent {
  const logger = logs.getLogger('onboarding-component')

  const recordCheckpoint = async (payload: CheckpointPayload): Promise<void> => {
    let { wallet } = payload
    const { userIdentifier, identifierType, checkpointId, action, email, source, metadata } = payload

    if (wallet) {
      wallet = wallet.toLowerCase()
    }

    if (action === 'completed') {
      const result = await db.query(SQL`
        UPDATE onboarding_checkpoints
        SET completed_at = NOW(),
            email = COALESCE(${email ?? null}, email),
            wallet = COALESCE(${wallet ?? null}, wallet)
        WHERE user_id = ${userIdentifier}
          AND checkpoint = ${checkpointId}
          AND completed_at IS NULL
      `)

      if (result.rowCount === 0) {
        logger.warn(`[CP:${checkpointId}][USER:${userIdentifier}] No existing row for completed — inserting retroactively`)
        // ON CONFLICT preserves an existing completed_at so a duplicated
        // 'completed' delivery (Segment retry or out-of-order webhook) doesn't
        // shift the timestamp forward and delay nudges.
        await db.query(SQL`
          INSERT INTO onboarding_checkpoints (user_id, id_type, email, wallet, checkpoint, source, reached_at, completed_at)
          VALUES (
            ${userIdentifier},
            ${identifierType},
            ${email ?? null},
            ${wallet ?? null},
            ${checkpointId},
            ${source ?? 'backfill'},
            NOW(),
            NOW()
          )
          ON CONFLICT (user_id, checkpoint) DO UPDATE
            SET completed_at = COALESCE(onboarding_checkpoints.completed_at, NOW()),
                email = COALESCE(${email ?? null}, onboarding_checkpoints.email),
                wallet = COALESCE(${wallet ?? null}, onboarding_checkpoints.wallet)
        `)
      }

      logger.log(`[CP:${checkpointId}][USER:${userIdentifier}] Marked checkpoint as completed`)
      return
    }

    await db.query(SQL`
      INSERT INTO onboarding_checkpoints (user_id, id_type, email, wallet, checkpoint, source, metadata)
      VALUES (
        ${userIdentifier},
        ${identifierType},
        ${email ?? null},
        ${wallet ?? null},
        ${checkpointId},
        ${source ?? null},
        ${metadata ? JSON.stringify(metadata) : null}
      )
      ON CONFLICT (user_id, checkpoint) DO UPDATE
        SET email = COALESCE(${email ?? null}, onboarding_checkpoints.email),
            wallet = COALESCE(${wallet ?? null}, onboarding_checkpoints.wallet),
            metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, onboarding_checkpoints.metadata)
    `)

    logger.log(`[CP:${checkpointId}][USER:${userIdentifier}] Recorded checkpoint reached`)

    // CP2 reached implicitly closes CP1 for the same user_id (anon→auth funnel within
    // the same session). CP3 comes from a different source (Explorer) and may have a
    // different user_id, so it doesn't auto-complete CP2.
    if (checkpointId === 2) {
      await db.query(SQL`
        UPDATE onboarding_checkpoints
        SET completed_at = NOW()
        WHERE user_id = ${userIdentifier}
          AND checkpoint = 1
          AND completed_at IS NULL
      `)
    }

    // If CP1 reached arrives AFTER CP2 was already recorded (out-of-order
    // Segment delivery), the row would otherwise be left with completed_at=NULL
    // even though the user clearly progressed past CP1. Close it retroactively.
    if (checkpointId === 1) {
      await db.query(SQL`
        UPDATE onboarding_checkpoints
        SET completed_at = NOW()
        WHERE user_id = ${userIdentifier}
          AND checkpoint = 1
          AND completed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM onboarding_checkpoints later
            WHERE later.user_id = ${userIdentifier} AND later.checkpoint = 2
          )
      `)
    }
  }

  const getPendingNudges = async (sequence: 1 | 2): Promise<PendingNudge[]> => {
    const hours = SEQUENCE_HOURS[sequence]

    const result = await db.query<{ user_id: string; email: string }>(SQL`
      SELECT cp2.user_id, cp2.email
      FROM onboarding_checkpoints cp2
      LEFT JOIN email_nudges en
        ON en.user_id = cp2.user_id
       AND en.checkpoint = 2
       AND en.sequence = ${sequence}
      WHERE cp2.checkpoint = 2
        AND cp2.completed_at IS NOT NULL
        AND cp2.email IS NOT NULL
        AND cp2.completed_at < NOW() - (${hours} || ' hours')::interval
        AND en.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM onboarding_checkpoints cp3
          WHERE cp3.user_id = cp2.user_id AND cp3.checkpoint = 3
        )
    `)

    return result.rows.map(row => ({
      userId: row.user_id,
      email: row.email
    }))
  }

  const markNudgeSent = async (userId: string, sequence: 1 | 2, messageId?: string): Promise<void> => {
    await db.query(SQL`
      INSERT INTO email_nudges (user_id, checkpoint, sequence, email, sendgrid_message_id)
      SELECT
        ${userId},
        2,
        ${sequence},
        oc.email,
        ${messageId ?? null}
      FROM onboarding_checkpoints oc
      WHERE oc.user_id = ${userId} AND oc.checkpoint = 2
      ON CONFLICT (user_id, checkpoint, sequence) DO NOTHING
    `)

    logger.log(`[CP:2][USER:${userId}][SEQ:${sequence}] Nudge marked as sent`)
  }

  return {
    recordCheckpoint,
    getPendingNudges,
    markNudgeSent
  }
}
