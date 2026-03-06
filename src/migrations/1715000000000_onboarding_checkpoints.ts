import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('onboarding_checkpoints', {
    id: {
      type: 'serial',
      primaryKey: true
    },
    user_id: {
      type: 'text',
      notNull: true
    },
    id_type: {
      type: 'text',
      notNull: true
    },
    email: {
      type: 'text',
      notNull: false
    },
    checkpoint: {
      type: 'integer',
      notNull: true
    },
    reached_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    completed_at: {
      type: 'timestamptz',
      notNull: false
    },
    source: {
      type: 'text',
      notNull: false
    },
    metadata: {
      type: 'jsonb',
      notNull: false
    }
  })

  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_id_type_check', {
    check: "id_type IN ('email', 'wallet')"
  })

  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_checkpoint_check', {
    check: 'checkpoint BETWEEN 1 AND 7'
  })

  pgm.addConstraint('onboarding_checkpoints', 'onboarding_checkpoints_user_checkpoint_unique', {
    unique: ['user_id', 'checkpoint']
  })

  pgm.createIndex('onboarding_checkpoints', ['email', 'checkpoint', 'reached_at'], {
    name: 'idx_onboarding_checkpoints_email_pending',
    where: 'email IS NOT NULL AND completed_at IS NULL'
  })

  pgm.createIndex('onboarding_checkpoints', ['user_id'])
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('onboarding_checkpoints')
}
