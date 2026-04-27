import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export function up(pgm: MigrationBuilder): void {
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

  pgm.sql('DELETE FROM email_nudges WHERE sequence = 3 OR checkpoint > 3')
  pgm.sql('DELETE FROM onboarding_checkpoints WHERE checkpoint > 3')

  pgm.createIndex('onboarding_checkpoints', ['completed_at'], {
    name: 'idx_oc_cp2_completed_with_email',
    where: 'checkpoint = 2 AND email IS NOT NULL AND completed_at IS NOT NULL'
  })
}

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
