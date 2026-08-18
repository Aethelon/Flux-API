import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"
import { supplyMigration } from "./006-supply.js"

export const removeSupplyMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      UPDATE stock_movements
      SET
        source_type = CASE
          WHEN source_type = 'goods_receipt' THEN 'manual_receipt'
          ELSE 'manual_adjustment'
        END,
        source_id = NULL,
        source_reference = NULL
      WHERE source_type IN ('goods_receipt', 'goods_receipt_reversal')
    `.execute(db)

    await sql`DROP TABLE goods_receipt_items`.execute(db)
    await sql`DROP TABLE goods_receipts`.execute(db)
    await sql`DROP TABLE purchase_order_items`.execute(db)
    await sql`DROP TABLE purchase_orders`.execute(db)
    await sql`DROP TABLE product_suppliers`.execute(db)
    await sql`DROP TABLE suppliers`.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await supplyMigration.up(db)
    await sql`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_recommendation_fk
        FOREIGN KEY (tenant_id, recommendation_id)
        REFERENCES recommendations(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
  },
}
