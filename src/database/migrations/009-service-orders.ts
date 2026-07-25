import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const serviceOrdersMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE service_order_columns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        label text NOT NULL,
        semantic_type text NOT NULL CHECK (
          semantic_type IN ('open', 'completed', 'cancelled')
        ),
        color_token text NOT NULL,
        display_position integer NOT NULL CHECK (display_position >= 0),
        protected boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (NOT protected OR semantic_type = 'completed')
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX service_order_columns_tenant_label_uidx
      ON service_order_columns (tenant_id, lower(label))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX service_order_columns_position_uidx
      ON service_order_columns (tenant_id, display_position)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX service_order_columns_completed_uidx
      ON service_order_columns (tenant_id)
      WHERE semantic_type = 'completed' AND archived_at IS NULL
    `.execute(db)

    await sql`
      INSERT INTO service_order_columns (
        tenant_id,
        label,
        semantic_type,
        color_token,
        display_position,
        protected,
        created_by,
        updated_by
      )
      SELECT
        tenant.id,
        seed.label,
        seed.semantic_type,
        seed.color_token,
        seed.display_position,
        seed.protected,
        admin.id,
        admin.id
      FROM tenants AS tenant
      CROSS JOIN LATERAL (
        SELECT id
        FROM users
        WHERE tenant_id = tenant.id
          AND role = 'admin'
          AND status = 'active'
          AND archived_at IS NULL
        ORDER BY created_at, id
        LIMIT 1
      ) AS admin
      CROSS JOIN (
        VALUES
          ('Pendente', 'open', '--color-warning', 0, false),
          ('Em Andamento', 'open', '--color-accent', 1, false),
          ('Aguardando Peças', 'open', '--color-info', 2, false),
          ('Concluído', 'completed', '--color-success', 3, true),
          ('Cancelado', 'cancelled', '--color-danger', 4, false)
      ) AS seed(label, semantic_type, color_token, display_position, protected)
    `.execute(db)

    await sql`
      CREATE TABLE service_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        business_number bigint NOT NULL CHECK (business_number > 0),
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        customer_name_snapshot text NOT NULL,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at timestamptz,
        estimated_value_cents bigint NOT NULL CHECK (estimated_value_cents >= 0),
        final_sale_id uuid UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
        current_column_id uuid NOT NULL REFERENCES service_order_columns(id) ON DELETE RESTRICT,
        current_status text NOT NULL CHECK (
          current_status IN ('open', 'completed', 'cancelled')
        ),
        responsible_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        completed_at timestamptz,
        cancelled_at timestamptz,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, business_number),
        CHECK (
          (current_status = 'open' AND completed_at IS NULL AND cancelled_at IS NULL)
          OR
          (current_status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
          OR
          (current_status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX service_orders_board_idx
      ON service_orders (tenant_id, current_column_id, due_at, id)
    `.execute(db)

    await sql`
      CREATE INDEX service_orders_tenant_time_idx
      ON service_orders (tenant_id, created_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE service_order_status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        service_order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
        previous_column_id uuid REFERENCES service_order_columns(id) ON DELETE RESTRICT,
        new_column_id uuid NOT NULL REFERENCES service_order_columns(id) ON DELETE RESTRICT,
        previous_status text CHECK (
          previous_status IS NULL OR previous_status IN ('open', 'completed', 'cancelled')
        ),
        new_status text NOT NULL CHECK (
          new_status IN ('open', 'completed', 'cancelled')
        ),
        actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        reason text NOT NULL,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)

    await sql`
      CREATE INDEX service_order_history_order_time_idx
      ON service_order_status_history (
        tenant_id,
        service_order_id,
        occurred_at DESC,
        id DESC
      )
    `.execute(db)

    await sql`
      ALTER TABLE sale_items
      ALTER COLUMN product_id DROP NOT NULL
    `.execute(db)

    await sql`
      ALTER TABLE sale_items
      ADD COLUMN service_order_previous_column_id uuid
        REFERENCES service_order_columns(id) ON DELETE RESTRICT
    `.execute(db)

    await sql`
      ALTER TABLE sale_items
      ADD CONSTRAINT sale_items_source_check CHECK (
        (product_id IS NOT NULL
          AND service_order_id IS NULL
          AND service_order_previous_column_id IS NULL)
        OR
        (product_id IS NULL
          AND service_order_id IS NOT NULL
          AND service_order_previous_column_id IS NOT NULL
          AND product_type_snapshot = 'service'
          AND quantity = 1)
      )
    `.execute(db)

    await sql`
      ALTER TABLE sale_items
      ADD CONSTRAINT sale_items_service_order_fk
      FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE RESTRICT
    `.execute(db)

    await sql`
      ALTER TABLE sale_items
      DROP CONSTRAINT sale_items_tenant_id_sale_id_product_id_key
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX sale_items_product_source_uidx
      ON sale_items (tenant_id, sale_id, product_id)
      WHERE product_id IS NOT NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX sale_items_service_order_source_uidx
      ON sale_items (tenant_id, service_order_id)
      WHERE service_order_id IS NOT NULL
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS sale_items_service_order_source_uidx`.execute(db)
    await sql`DROP INDEX IF EXISTS sale_items_product_source_uidx`.execute(db)
    await sql`
      ALTER TABLE sale_items
      DROP CONSTRAINT IF EXISTS sale_items_service_order_fk
    `.execute(db)
    await sql`
      ALTER TABLE sale_items
      DROP CONSTRAINT IF EXISTS sale_items_source_check
    `.execute(db)
    await sql`
      ALTER TABLE sale_items
      DROP COLUMN IF EXISTS service_order_previous_column_id
    `.execute(db)
    await sql`
      ALTER TABLE sale_items
      ALTER COLUMN product_id SET NOT NULL
    `.execute(db)
    await sql`
      ALTER TABLE sale_items
      ADD CONSTRAINT sale_items_tenant_id_sale_id_product_id_key
      UNIQUE (tenant_id, sale_id, product_id)
    `.execute(db)
    await sql`DROP TABLE IF EXISTS service_order_status_history`.execute(db)
    await sql`DROP TABLE IF EXISTS service_orders`.execute(db)
    await sql`DROP TABLE IF EXISTS service_order_columns`.execute(db)
  },
}
