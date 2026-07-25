import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const zeroValueReturnsMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE sale_returns
      DROP CONSTRAINT sale_returns_total_amount_cents_check
    `.execute(db)
    await sql`
      ALTER TABLE sale_returns
      ADD CONSTRAINT sale_returns_total_amount_cents_check
      CHECK (total_amount_cents >= 0)
    `.execute(db)
    await sql`
      ALTER TABLE sale_return_items
      DROP CONSTRAINT sale_return_items_amount_cents_check
    `.execute(db)
    await sql`
      ALTER TABLE sale_return_items
      ADD CONSTRAINT sale_return_items_amount_cents_check
      CHECK (amount_cents >= 0)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE sale_return_items
      DROP CONSTRAINT sale_return_items_amount_cents_check
    `.execute(db)
    await sql`
      ALTER TABLE sale_return_items
      ADD CONSTRAINT sale_return_items_amount_cents_check
      CHECK (amount_cents > 0)
    `.execute(db)
    await sql`
      ALTER TABLE sale_returns
      DROP CONSTRAINT sale_returns_total_amount_cents_check
    `.execute(db)
    await sql`
      ALTER TABLE sale_returns
      ADD CONSTRAINT sale_returns_total_amount_cents_check
      CHECK (total_amount_cents > 0)
    `.execute(db)
  },
}
