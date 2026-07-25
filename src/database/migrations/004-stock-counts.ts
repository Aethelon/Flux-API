import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const stockCountsMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE stock_counts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        status text NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'confirmed', 'cancelled')),
        reason text NOT NULL,
        started_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        started_at timestamptz NOT NULL DEFAULT now(),
        confirmed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        confirmed_at timestamptz,
        cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        cancelled_at timestamptz,
        cancellation_reason text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (status = 'draft'
            AND confirmed_by IS NULL
            AND confirmed_at IS NULL
            AND cancelled_by IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL)
          OR
          (status = 'confirmed'
            AND confirmed_by IS NOT NULL
            AND confirmed_at IS NOT NULL
            AND cancelled_by IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL)
          OR
          (status = 'cancelled'
            AND confirmed_by IS NULL
            AND confirmed_at IS NULL
            AND cancelled_by IS NOT NULL
            AND cancelled_at IS NOT NULL
            AND cancellation_reason IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX stock_counts_tenant_time_idx
      ON stock_counts (tenant_id, started_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE stock_count_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        stock_count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        expected_quantity numeric(18, 3) NOT NULL CHECK (expected_quantity >= 0),
        counted_quantity numeric(18, 3) CHECK (counted_quantity >= 0),
        difference numeric(18, 3),
        unit_cost_snapshot_cents numeric(20, 6)
          CHECK (unit_cost_snapshot_cents >= 0),
        movement_id uuid REFERENCES stock_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        UNIQUE (tenant_id, stock_count_id, product_id),
        CHECK (
          (counted_quantity IS NULL
            AND difference IS NULL
            AND unit_cost_snapshot_cents IS NULL
            AND movement_id IS NULL)
          OR
          (counted_quantity IS NOT NULL AND difference IS NOT NULL)
        ),
        CHECK (
          movement_id IS NULL OR difference <> 0
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX stock_count_items_count_idx
      ON stock_count_items (tenant_id, stock_count_id, product_id)
    `.execute(db)

    await sql`
      CREATE TABLE stockout_intervals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        started_at timestamptz NOT NULL,
        ended_at timestamptz,
        detected_reason text NOT NULL,
        source_movement_id uuid REFERENCES stock_movements(id) ON DELETE RESTRICT,
        ended_by_movement_id uuid REFERENCES stock_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX stockout_intervals_active_uidx
      ON stockout_intervals (tenant_id, product_id)
      WHERE ended_at IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX stockout_intervals_product_time_idx
      ON stockout_intervals (tenant_id, product_id, started_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE inventory_daily_snapshots (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        local_date date NOT NULL,
        opening numeric(18, 3) NOT NULL CHECK (opening >= 0),
        received numeric(18, 3) NOT NULL DEFAULT 0 CHECK (received >= 0),
        sold numeric(18, 3) NOT NULL DEFAULT 0 CHECK (sold >= 0),
        returned numeric(18, 3) NOT NULL DEFAULT 0 CHECK (returned >= 0),
        adjusted numeric(18, 3) NOT NULL DEFAULT 0,
        closing numeric(18, 3) NOT NULL CHECK (closing >= 0),
        reserved numeric(18, 3) NOT NULL CHECK (reserved >= 0),
        in_stock_minutes numeric(12, 4) NOT NULL DEFAULT 0 CHECK (in_stock_minutes >= 0),
        stockout_minutes numeric(12, 4) NOT NULL DEFAULT 0 CHECK (stockout_minutes >= 0),
        observed_minutes numeric(12, 4) NOT NULL DEFAULT 0 CHECK (observed_minutes >= 0),
        last_observed_at timestamptz NOT NULL,
        complete boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, product_id, local_date),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        CHECK (reserved <= closing),
        CHECK (in_stock_minutes + stockout_minutes <= observed_minutes + 0.0001)
      )
    `.execute(db)

    await sql`
      CREATE INDEX inventory_daily_snapshots_tenant_date_idx
      ON inventory_daily_snapshots (tenant_id, local_date DESC, product_id)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS inventory_daily_snapshots`.execute(db)
    await sql`DROP TABLE IF EXISTS stockout_intervals`.execute(db)
    await sql`DROP TABLE IF EXISTS stock_count_items`.execute(db)
    await sql`DROP TABLE IF EXISTS stock_counts`.execute(db)
  },
}
