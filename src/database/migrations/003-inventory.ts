import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const inventoryMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE products
      ADD CONSTRAINT products_tenant_id_id_unique UNIQUE (tenant_id, id)
    `.execute(db)

    await sql`
      CREATE TABLE inventory_balances (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        on_hand numeric(18, 3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
        reserved numeric(18, 3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
        average_unit_cost_cents numeric(20, 6)
          CHECK (average_unit_cost_cents >= 0),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, product_id),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        CHECK (reserved <= on_hand)
      )
    `.execute(db)

    await sql`
      INSERT INTO inventory_balances (tenant_id, product_id)
      SELECT tenant_id, id
      FROM products
      WHERE type <> 'service'
    `.execute(db)

    await sql`
      CREATE INDEX inventory_balances_tenant_stock_idx
      ON inventory_balances (tenant_id, on_hand, product_id)
    `.execute(db)

    await sql`
      CREATE TABLE stock_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        movement_type text NOT NULL CHECK (
          movement_type IN (
            'receipt',
            'sale',
            'sale_reversal',
            'return',
            'reservation',
            'reservation_release',
            'positive_adjustment',
            'negative_adjustment',
            'stock_count_adjustment'
          )
        ),
        quantity numeric(18, 3) NOT NULL CHECK (quantity <> 0),
        resulting_on_hand numeric(18, 3) NOT NULL CHECK (resulting_on_hand >= 0),
        resulting_reserved numeric(18, 3) NOT NULL CHECK (resulting_reserved >= 0),
        unit_cost_snapshot_cents numeric(20, 6)
          CHECK (unit_cost_snapshot_cents >= 0),
        source_type text NOT NULL,
        source_id uuid,
        source_reference text,
        reason text NOT NULL,
        actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        reversal_of_id uuid REFERENCES stock_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        CHECK (resulting_reserved <= resulting_on_hand),
        CHECK (
          (movement_type IN (
            'receipt',
            'sale_reversal',
            'return',
            'positive_adjustment'
          ) AND quantity > 0)
          OR
          (movement_type IN (
            'sale',
            'negative_adjustment'
          ) AND quantity < 0)
          OR movement_type IN (
            'reservation',
            'reservation_release',
            'stock_count_adjustment'
          )
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX stock_movements_product_time_idx
      ON stock_movements (tenant_id, product_id, occurred_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE INDEX stock_movements_tenant_time_idx
      ON stock_movements (tenant_id, occurred_at DESC, id DESC)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS stock_movements`.execute(db)
    await sql`DROP TABLE IF EXISTS inventory_balances`.execute(db)
    await sql`
      ALTER TABLE products
      DROP CONSTRAINT IF EXISTS products_tenant_id_id_unique
    `.execute(db)
  },
}
