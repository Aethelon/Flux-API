import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const catalogMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (parent_id IS NULL OR parent_id <> id)
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX categories_tenant_name_active_uidx
      ON categories (tenant_id, lower(name))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX categories_tenant_active_idx
      ON categories (tenant_id, active, name, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name text NOT NULL,
        abbreviation text NOT NULL,
        allows_fractional boolean NOT NULL DEFAULT false,
        quantity_scale smallint NOT NULL DEFAULT 0
          CHECK (quantity_scale BETWEEN 0 AND 3),
        active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (
          (allows_fractional AND quantity_scale > 0)
          OR (NOT allows_fractional AND quantity_scale = 0)
        )
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX units_tenant_name_active_uidx
      ON units (tenant_id, lower(name))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX units_tenant_abbreviation_active_uidx
      ON units (tenant_id, lower(abbreviation))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        sku text,
        barcode text,
        type text NOT NULL
          CHECK (type IN ('raw_material', 'finished_product', 'packaging', 'service')),
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        minimum_stock numeric(18, 3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
        current_price_cents integer NOT NULL CHECK (current_price_cents >= 0),
        current_cost_cents integer CHECK (current_cost_cents >= 0),
        cost_source text
          CHECK (cost_source IN ('manual', 'receipt', 'moving_average', 'estimated')),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (
          (type = 'service' AND minimum_stock = 0)
          OR type <> 'service'
        ),
        CHECK (
          (current_cost_cents IS NULL AND cost_source IS NULL)
          OR (current_cost_cents IS NOT NULL AND cost_source IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX products_tenant_sku_active_uidx
      ON products (tenant_id, lower(sku))
      WHERE archived_at IS NULL AND sku IS NOT NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX products_tenant_barcode_active_uidx
      ON products (tenant_id, barcode)
      WHERE archived_at IS NULL AND barcode IS NOT NULL
    `.execute(db)

    await sql`
      CREATE INDEX products_tenant_list_idx
      ON products (tenant_id, active, name, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX products_tenant_category_idx
      ON products (tenant_id, category_id, name, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE product_price_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        old_price_cents integer CHECK (old_price_cents >= 0),
        new_price_cents integer NOT NULL CHECK (new_price_cents >= 0),
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reason text NOT NULL,
        effective_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)

    await sql`
      CREATE INDEX product_price_history_product_time_idx
      ON product_price_history (tenant_id, product_id, effective_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE product_cost_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        old_cost_cents integer CHECK (old_cost_cents >= 0),
        new_cost_cents integer CHECK (new_cost_cents >= 0),
        source text
          CHECK (source IN ('manual', 'receipt', 'moving_average', 'estimated')),
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reason text NOT NULL,
        effective_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (new_cost_cents IS NULL AND source IS NULL)
          OR (new_cost_cents IS NOT NULL AND source IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX product_cost_history_product_time_idx
      ON product_cost_history (tenant_id, product_id, effective_at DESC, id DESC)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS product_cost_history`.execute(db)
    await sql`DROP TABLE IF EXISTS product_price_history`.execute(db)
    await sql`DROP TABLE IF EXISTS products`.execute(db)
    await sql`DROP TABLE IF EXISTS units`.execute(db)
    await sql`DROP TABLE IF EXISTS categories`.execute(db)
  },
}
