import SQL from 'sql-template-strings'
import { AppComponents } from '../../types'
import { CheckpointPayload, IOnboardingComponent, PendingNudge } from './types'

// Index 0 is unused — sequence IDs start at 1.
const SEQUENCE_HOURS = [0, 12, 24, 36]

export function createOnboardingComponent({ db, logs }: Pick<AppComponents, 'db' | 'logs'>): IOnboardingComponent {
  const logger = logs.getLogger('onboarding-component')

  /**
   * When a checkpoint arrives with identifierType='wallet', try to find an
   * earlier checkpoint row that has the same wallet and an email. If found,
   * rewrite the identifier to the email-based user_id so all checkpoints
   * for this user share the same user_id and the nudge system works.
   */
  const resolveWalletIdentity = async (walletAddress: string): Promise<{ userId: string; email: string } | null> => {
    const result = await db.query<{ user_id: string; email: string }>(SQL`
      SELECT user_id, email
      FROM onboarding_checkpoints
      WHERE wallet = ${walletAddress}
        AND email IS NOT NULL
      ORDER BY checkpoint ASC
      LIMIT 1
    `)
    return result.rows.length > 0 ? { userId: result.rows[0].user_id, email: result.rows[0].email } : null
  }

  const recordCheckpoint = async (payload: CheckpointPayload): Promise<void> => {
    let { userIdentifier, identifierType, email, wallet } = payload
    const { checkpointId, action, source, metadata } = payload

    // Normalize wallet to lowercase
    if (wallet) {
      wallet = wallet.toLowerCase()
    }

    // When identifier is a wallet, try to resolve to the email-based user_id
    // so all checkpoints for this user share the same user_id.
    if (identifierType === 'wallet' && !email) {
      const resolved = await resolveWalletIdentity(userIdentifier.toLowerCase())
      if (resolved) {
        logger.log(`[CP:${checkpointId}][WALLET:${userIdentifier}] Resolved wallet to user_id=${resolved.userId}`)
        wallet = wallet ?? userIdentifier.toLowerCase()
        userIdentifier = resolved.userId
        identifierType = 'email'
        email = resolved.email
      } else {
        // No earlier checkpoint with this wallet — store with wallet as user_id
        wallet = wallet ?? userIdentifier.toLowerCase()
      }
    }

    if (action === 'completed') {
      await db.query(SQL`
        UPDATE onboarding_checkpoints
        SET completed_at = NOW(),
            email = COALESCE(${email ?? null}, email),
            wallet = COALESCE(${wallet ?? null}, wallet)
        WHERE user_id = ${userIdentifier}
          AND checkpoint = ${checkpointId}
          AND completed_at IS NULL
      `)
      logger.log(`[CP:${checkpointId}][USER:${userIdentifier}] Marked checkpoint as completed`)
      return
    }

    // action === 'reached': upsert the checkpoint record
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

    // Implicitly mark previous checkpoint as completed when reaching CP(N)
    if (checkpointId > 1) {
      await db.query(SQL`
        UPDATE onboarding_checkpoints
        SET completed_at = NOW()
        WHERE user_id = ${userIdentifier}
          AND checkpoint = ${checkpointId - 1}
          AND completed_at IS NULL
      `)
    }
  }

  const getPendingNudges = async (sequence: 1 | 2 | 3): Promise<PendingNudge[]> => {
    const hours = SEQUENCE_HOURS[sequence]

    const result = await db.query<{ user_id: string; checkpoint: number; email: string }>(SQL`
      SELECT oc.user_id, oc.checkpoint, oc.email
      FROM onboarding_checkpoints oc
      LEFT JOIN email_nudges en
        ON en.user_id = oc.user_id
        AND en.checkpoint = oc.checkpoint
        AND en.sequence = ${sequence}
      WHERE
        oc.email IS NOT NULL
        AND oc.completed_at IS NULL
        AND oc.reached_at < NOW() - (${hours} || ' hours')::interval
        AND en.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM onboarding_checkpoints later
          WHERE later.user_id = oc.user_id
            AND later.checkpoint > oc.checkpoint
        )
    `)

    return result.rows.map(row => ({
      userId: row.user_id,
      checkpointId: row.checkpoint,
      email: row.email
    }))
  }

  const markNudgeSent = async (userId: string, checkpointId: number, sequence: number, messageId?: string): Promise<void> => {
    await db.query(SQL`
      INSERT INTO email_nudges (user_id, checkpoint, sequence, email, sendgrid_message_id)
      SELECT
        ${userId},
        ${checkpointId},
        ${sequence},
        oc.email,
        ${messageId ?? null}
      FROM onboarding_checkpoints oc
      WHERE oc.user_id = ${userId} AND oc.checkpoint = ${checkpointId}
      ON CONFLICT (user_id, checkpoint, sequence) DO NOTHING
    `)

    logger.log(`[CP:${checkpointId}][USER:${userId}][SEQ:${sequence}] Nudge marked as sent`)
  }

  return {
    recordCheckpoint,
    getPendingNudges,
    markNudgeSent
  }
}
