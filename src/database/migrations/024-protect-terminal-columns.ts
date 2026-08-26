import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const protectTerminalColumnsMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE service_order_columns
      DROP CONSTRAINT service_order_columns_check
    `.execute(db)
    await sql`
      UPDATE service_order_columns
      SET protected = semantic_type IN ('completed', 'cancelled')
    `.execute(db)
    await sql`
      ALTER TABLE service_order_columns
      ADD CONSTRAINT service_order_columns_terminal_protection_check
      CHECK (protected = (semantic_type IN ('completed', 'cancelled')))
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE service_order_columns
      DROP CONSTRAINT service_order_columns_terminal_protection_check
    `.execute(db)
    await sql`
      UPDATE service_order_columns
      SET protected = semantic_type = 'completed'
    `.execute(db)
    await sql`
      ALTER TABLE service_order_columns
      ADD CONSTRAINT service_order_columns_check
      CHECK (NOT protected OR semantic_type = 'completed')
    `.execute(db)
  },
}
