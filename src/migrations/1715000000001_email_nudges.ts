import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('email_nudges', {
    id: {
      type: 'serial',
      primaryKey: true
    },
    user_id: {
      type: 'text',
      notNull: true
    },
    checkpoint: {
      type: 'integer',
      notNull: true
    },
    sequence: {
      type: 'integer',
      notNull: true
    },
    email: {
      type: 'text',
      notNull: true
    },
    sent_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    sendgrid_message_id: {
      type: 'text',
      notNull: false
    }
  })

  pgm.addConstraint('email_nudges', 'email_nudges_sequence_check', {
    check: 'sequence IN (1, 2, 3)'
  })

  pgm.addConstraint('email_nudges', 'email_nudges_user_checkpoint_sequence_unique', {
    unique: ['user_id', 'checkpoint', 'sequence']
  })

  pgm.createIndex('email_nudges', ['user_id', 'checkpoint'])
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('email_nudges')
}
