import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('onboarding_checkpoints', {
    wallet: {
      type: 'text',
      notNull: false
    }
  })

  pgm.createIndex('onboarding_checkpoints', ['wallet'], {
    name: 'idx_onboarding_checkpoints_wallet',
    where: 'wallet IS NOT NULL'
  })
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('onboarding_checkpoints', ['wallet'], {
    name: 'idx_onboarding_checkpoints_wallet'
  })
  pgm.dropColumn('onboarding_checkpoints', 'wallet')
}
