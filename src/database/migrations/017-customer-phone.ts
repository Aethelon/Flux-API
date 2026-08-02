import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const customerPhoneMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE UNIQUE INDEX customers_tenant_phone_active_uidx
      ON customers (tenant_id, regexp_replace(phone, '[^0-9]', '', 'g'))
      WHERE archived_at IS NULL AND phone IS NOT NULL
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS customers_tenant_phone_active_uidx`.execute(db)
  },
}
