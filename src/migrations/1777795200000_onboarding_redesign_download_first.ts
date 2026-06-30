import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

/**
 * IMPORTANT: this migration must run BEFORE the new app code is deployed.
 * The new code emits/accepts `id_type='anon'` and `checkpointId ∈ {1,2,3}`,
 * which the old constraints reject.
 *
 * Also: the legacy data cleanup MUST happen before the new CHECK constraints
 * are added. PostgreSQL validates all existing rows when ADD CONSTRAINT runs,
 * so adding `checkpoint BETWEEN 1 AND 3` while CP4..7 rows still exist would
 * abort the migration.
 */
export function up(pgm: MigrationBuilder): void {
  // 1) Cleanup legacy rows BEFORE tightening constraints (otherwise ADD CHECK
  //    would scan existing rows and fail).
  pgm.sql('DELETE FROM email_nudges WHERE sequence = 3 OR checkpoint > 3')
  pgm.sql('DELETE FROM onboarding_checkpoints WHERE checkpoint > 3')

  // 2) Replace constraints with the new tight ones.
  pgm.dropConstraint('onboarding_checkpoints', 'onboarding_checkpoints_checkpoint_check')
  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_checkpoint_check', {
    check: 'checkpoint BETWEEN 1 AND 3'
  })

  pgm.dropConstraint('onboarding_checkpoints', 'onboarding_checkpoints_id_type_check')
  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_id_type_check', {
    check: "id_type IN ('anon', 'email', 'wallet')"
  })

  pgm.dropConstraint('email_nudges', 'email_nudges_sequence_check')
  pgm.addConstraint('email_nudges', 'email_nudges_sequence_check', {
    check: 'sequence IN (1, 2)'
  })

  // 3) Partial covering index that satisfies the nudge query as an index-only
  //    scan (returns user_id + email without touching the heap).
  pgm.createIndex('onboarding_checkpoints', ['completed_at'], {
    name: 'idx_oc_cp2_completed_with_email',
    where: 'checkpoint = 2 AND email IS NOT NULL AND completed_at IS NOT NULL',
    include: ['user_id', 'email']
  })
}

/**
 * ⚠️ DATA LOSS WARNING ⚠️
 *
 * Running `down()` does NOT restore the rows deleted by `up()`. Legacy
 * checkpoints (CP4..CP7) and nudges with sequence 3 are unrecoverable —
 * if you need them back, restore from a backup taken before `up()` ran.
 *
 * The constraints are restored to their pre-redesign shape so the table
 * structure is technically reversible, but the data is not.
 */
export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('onboarding_checkpoints', ['completed_at'], {
    name: 'idx_oc_cp2_completed_with_email'
  })

  pgm.dropConstraint('email_nudges', 'email_nudges_sequence_check')
  pgm.addConstraint('email_nudges', 'email_nudges_sequence_check', {
    check: 'sequence IN (1, 2, 3)'
  })

  pgm.dropConstraint('onboarding_checkpoints', 'onboarding_checkpoints_id_type_check')
  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_id_type_check', {
    check: "id_type IN ('email', 'wallet')"
  })

  pgm.dropConstraint('onboarding_checkpoints', 'onboarding_checkpoints_checkpoint_check')
  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_checkpoint_check', {
    check: 'checkpoint BETWEEN 1 AND 7'
  })
}
