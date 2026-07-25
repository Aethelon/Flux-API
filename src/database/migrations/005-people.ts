import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const peopleMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE tenant_sequences (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        sequence_name text NOT NULL,
        current_value bigint NOT NULL DEFAULT 0 CHECK (current_value >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, sequence_name)
      )
    `.execute(db)

    await sql`
      CREATE TABLE customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name text NOT NULL,
        email text,
        phone text,
        notes text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'inactive')),
        consent_at timestamptz,
        anonymized_at timestamptz,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (
          anonymized_at IS NULL
          OR (email IS NULL AND phone IS NULL AND notes = '')
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX customers_tenant_list_idx
      ON customers (tenant_id, status, name, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX customers_tenant_email_idx
      ON customers (tenant_id, lower(email))
      WHERE archived_at IS NULL AND email IS NOT NULL
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS customers`.execute(db)
    await sql`DROP TABLE IF EXISTS tenant_sequences`.execute(db)
  },
}
