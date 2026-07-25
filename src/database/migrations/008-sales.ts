import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const salesMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE sales (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        business_number bigint NOT NULL CHECK (business_number > 0),
        status text NOT NULL CHECK (
          status IN ('completed', 'partially_returned', 'returned', 'cancelled')
        ),
        customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
        customer_name_snapshot text,
        operator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        gross_amount_cents bigint NOT NULL CHECK (gross_amount_cents >= 0),
        discount_amount_cents bigint NOT NULL CHECK (
          discount_amount_cents >= 0 AND discount_amount_cents <= gross_amount_cents
        ),
        net_amount_cents bigint NOT NULL CHECK (
          net_amount_cents = gross_amount_cents - discount_amount_cents
        ),
        returned_amount_cents bigint NOT NULL DEFAULT 0 CHECK (
          returned_amount_cents >= 0 AND returned_amount_cents <= net_amount_cents
        ),
        change_amount_cents bigint NOT NULL CHECK (change_amount_cents >= 0),
        business_date date NOT NULL,
        completed_at timestamptz NOT NULL DEFAULT now(),
        cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        cancelled_at timestamptz,
        cancellation_reason text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, business_number),
        CHECK (
          (status = 'cancelled'
            AND cancelled_by IS NOT NULL
            AND cancelled_at IS NOT NULL
            AND cancellation_reason IS NOT NULL)
          OR
          (status <> 'cancelled'
            AND cancelled_by IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX sales_tenant_time_idx
      ON sales (tenant_id, completed_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE INDEX sales_session_idx
      ON sales (tenant_id, cash_session_id, completed_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE sale_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name_snapshot text NOT NULL,
        product_type_snapshot text NOT NULL CHECK (
          product_type_snapshot IN ('raw_material', 'finished_product', 'packaging', 'service')
        ),
        unit_abbreviation_snapshot text NOT NULL,
        quantity numeric(18, 3) NOT NULL CHECK (quantity > 0),
        unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
        gross_amount_cents bigint NOT NULL CHECK (gross_amount_cents >= 0),
        allocated_discount_cents bigint NOT NULL CHECK (
          allocated_discount_cents >= 0
          AND allocated_discount_cents <= gross_amount_cents
        ),
        net_amount_cents bigint NOT NULL CHECK (
          net_amount_cents = gross_amount_cents - allocated_discount_cents
        ),
        unit_cost_snapshot_cents numeric(20, 6)
          CHECK (unit_cost_snapshot_cents >= 0),
        returned_quantity numeric(18, 3) NOT NULL DEFAULT 0 CHECK (
          returned_quantity >= 0 AND returned_quantity <= quantity
        ),
        returned_net_amount_cents bigint NOT NULL DEFAULT 0 CHECK (
          returned_net_amount_cents >= 0
          AND returned_net_amount_cents <= net_amount_cents
        ),
        service_order_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, sale_id, product_id)
      )
    `.execute(db)

    await sql`
      CREATE INDEX sale_items_product_idx
      ON sale_items (tenant_id, product_id, sale_id)
    `.execute(db)

    await sql`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        payment_method text NOT NULL CHECK (
          payment_method IN ('cash', 'credit', 'debit', 'pix')
        ),
        amount_cents bigint NOT NULL CHECK (amount_cents > 0),
        effective_amount_cents bigint NOT NULL CHECK (
          effective_amount_cents >= 0 AND effective_amount_cents <= amount_cents
        ),
        installments smallint CHECK (installments IS NULL OR installments > 0),
        status text NOT NULL DEFAULT 'completed' CHECK (
          status IN ('completed', 'reversed', 'partially_refunded', 'refunded')
        ),
        external_reference text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (payment_method = 'credit' AND installments IS NOT NULL)
          OR (payment_method <> 'credit' AND installments IS NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX payments_sale_idx
      ON payments (tenant_id, sale_id, id)
    `.execute(db)

    await sql`
      CREATE TABLE sale_returns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        business_number bigint NOT NULL CHECK (business_number > 0),
        sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        operator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        reason text NOT NULL,
        total_amount_cents bigint NOT NULL CHECK (total_amount_cents > 0),
        status text NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
        completed_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, business_number)
      )
    `.execute(db)

    await sql`
      CREATE INDEX sale_returns_sale_time_idx
      ON sale_returns (tenant_id, sale_id, completed_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE sale_return_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        return_id uuid NOT NULL REFERENCES sale_returns(id) ON DELETE RESTRICT,
        sale_item_id uuid NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
        quantity numeric(18, 3) NOT NULL CHECK (quantity > 0),
        amount_cents bigint NOT NULL CHECK (amount_cents > 0),
        restock boolean NOT NULL,
        unit_cost_snapshot_cents numeric(20, 6)
          CHECK (unit_cost_snapshot_cents >= 0),
        stock_movement_id uuid REFERENCES stock_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, return_id, sale_item_id),
        CHECK (
          (restock AND stock_movement_id IS NOT NULL)
          OR (NOT restock AND stock_movement_id IS NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE TABLE sale_return_refunds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        return_id uuid NOT NULL REFERENCES sale_returns(id) ON DELETE RESTRICT,
        payment_method text NOT NULL CHECK (
          payment_method IN ('cash', 'credit', 'debit', 'pix')
        ),
        amount_cents bigint NOT NULL CHECK (amount_cents > 0),
        external_reference text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS sale_return_refunds`.execute(db)
    await sql`DROP TABLE IF EXISTS sale_return_items`.execute(db)
    await sql`DROP TABLE IF EXISTS sale_returns`.execute(db)
    await sql`DROP TABLE IF EXISTS payments`.execute(db)
    await sql`DROP TABLE IF EXISTS sale_items`.execute(db)
    await sql`DROP TABLE IF EXISTS sales`.execute(db)
  },
}
