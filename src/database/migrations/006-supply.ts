import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const supplyMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        legal_name text NOT NULL,
        trade_name text,
        tax_id text,
        email text,
        phone text,
        contact_name text,
        notes text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX suppliers_tenant_tax_id_uidx
      ON suppliers (tenant_id, tax_id)
      WHERE archived_at IS NULL AND tax_id IS NOT NULL
    `.execute(db)

    await sql`
      CREATE INDEX suppliers_tenant_list_idx
      ON suppliers (tenant_id, active, legal_name, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE product_suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        supplier_sku text,
        active boolean NOT NULL DEFAULT true,
        lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
        minimum_order_quantity numeric(18, 3) NOT NULL
          CHECK (minimum_order_quantity > 0),
        pack_multiple numeric(18, 3) NOT NULL CHECK (pack_multiple > 0),
        valid_from timestamptz NOT NULL DEFAULT now(),
        valid_until timestamptz,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        CHECK (valid_until IS NULL OR valid_until > valid_from)
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX product_suppliers_current_uidx
      ON product_suppliers (tenant_id, supplier_id, product_id)
      WHERE valid_until IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX product_suppliers_product_idx
      ON product_suppliers (tenant_id, product_id, valid_from DESC)
    `.execute(db)

    await sql`
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        business_number bigint NOT NULL CHECK (business_number > 0),
        supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        status text NOT NULL DEFAULT 'draft' CHECK (
          status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')
        ),
        ordered_at timestamptz,
        expected_at timestamptz,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        approved_at timestamptz,
        cancellation_reason text,
        recommendation_id uuid,
        notes text NOT NULL DEFAULT '',
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, business_number),
        CHECK (
          (status = 'draft' AND ordered_at IS NULL AND approved_at IS NULL)
          OR status <> 'draft'
        ),
        CHECK (
          status <> 'cancelled' OR cancellation_reason IS NOT NULL
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX purchase_orders_tenant_list_idx
      ON purchase_orders (tenant_id, status, created_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE purchase_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        product_name_snapshot text NOT NULL,
        unit_abbreviation_snapshot text NOT NULL,
        ordered_quantity numeric(18, 3) NOT NULL CHECK (ordered_quantity > 0),
        received_quantity numeric(18, 3) NOT NULL DEFAULT 0
          CHECK (received_quantity >= 0),
        agreed_unit_cost_cents numeric(20, 6) NOT NULL
          CHECK (agreed_unit_cost_cents >= 0),
        supplier_sku_snapshot text,
        pack_multiple_snapshot numeric(18, 3) NOT NULL CHECK (pack_multiple_snapshot > 0),
        minimum_order_quantity_snapshot numeric(18, 3) NOT NULL
          CHECK (minimum_order_quantity_snapshot > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        UNIQUE (tenant_id, purchase_order_id, product_id),
        CHECK (received_quantity <= ordered_quantity)
      )
    `.execute(db)

    await sql`
      CREATE TABLE goods_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        business_number bigint NOT NULL CHECK (business_number > 0),
        purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
        status text NOT NULL DEFAULT 'completed'
          CHECK (status IN ('completed', 'reversed')),
        supplier_document_reference text,
        received_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        received_at timestamptz NOT NULL DEFAULT now(),
        reversed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        reversed_at timestamptz,
        reversal_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, business_number),
        CHECK (
          (status = 'completed'
            AND reversed_by IS NULL
            AND reversed_at IS NULL
            AND reversal_reason IS NULL)
          OR
          (status = 'reversed'
            AND reversed_by IS NOT NULL
            AND reversed_at IS NOT NULL
            AND reversal_reason IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX goods_receipts_order_time_idx
      ON goods_receipts (tenant_id, purchase_order_id, received_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE goods_receipt_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE RESTRICT,
        purchase_order_item_id uuid NOT NULL
          REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL,
        received_quantity numeric(18, 3) NOT NULL CHECK (received_quantity > 0),
        accepted_unit_cost_cents numeric(20, 6) NOT NULL
          CHECK (accepted_unit_cost_cents >= 0),
        lot_reference text,
        stock_movement_id uuid NOT NULL REFERENCES stock_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tenant_id, product_id)
          REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
        UNIQUE (tenant_id, goods_receipt_id, purchase_order_item_id)
      )
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS goods_receipt_items`.execute(db)
    await sql`DROP TABLE IF EXISTS goods_receipts`.execute(db)
    await sql`DROP TABLE IF EXISTS purchase_order_items`.execute(db)
    await sql`DROP TABLE IF EXISTS purchase_orders`.execute(db)
    await sql`DROP TABLE IF EXISTS product_suppliers`.execute(db)
    await sql`DROP TABLE IF EXISTS suppliers`.execute(db)
  },
}
