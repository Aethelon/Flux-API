import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const phaseOneIntegrityMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      INSERT INTO stockout_intervals (
        tenant_id,
        product_id,
        started_at,
        ended_at,
        detected_reason,
        source_movement_id,
        ended_by_movement_id
      )
      SELECT
        product.tenant_id,
        product.id,
        product.created_at,
        NULL,
        'phase_one_integrity_backfill',
        NULL,
        NULL
      FROM products AS product
      INNER JOIN inventory_balances AS balance
        ON balance.tenant_id = product.tenant_id
        AND balance.product_id = product.id
      WHERE product.type <> 'service'
        AND product.active = true
        AND product.archived_at IS NULL
        AND balance.on_hand <= 0
      ON CONFLICT (tenant_id, product_id) WHERE ended_at IS NULL
      DO NOTHING
    `.execute(db)
  },

  async down(): Promise<void> {
    return Promise.resolve()
  },
}
