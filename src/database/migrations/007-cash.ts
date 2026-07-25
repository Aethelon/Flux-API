import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const cashMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE cash_registers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        code text NOT NULL,
        name text NOT NULL,
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
      CREATE UNIQUE INDEX cash_registers_tenant_code_uidx
      ON cash_registers (tenant_id, lower(code))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE cash_register_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
        valid_from timestamptz NOT NULL DEFAULT now(),
        valid_until timestamptz,
        assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (valid_until IS NULL OR valid_until > valid_from)
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX cash_assignments_current_user_uidx
      ON cash_register_assignments (tenant_id, user_id)
      WHERE valid_until IS NULL
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX cash_assignments_current_register_uidx
      ON cash_register_assignments (tenant_id, cash_register_id)
      WHERE valid_until IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE cash_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
        opening_operator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        opened_at timestamptz NOT NULL DEFAULT now(),
        opening_amount_cents bigint NOT NULL CHECK (opening_amount_cents >= 0),
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        closing_operator_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        closed_at timestamptz,
        closing_note text,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (status = 'open'
            AND closing_operator_id IS NULL
            AND closed_at IS NULL
            AND closing_note IS NULL)
          OR
          (status = 'closed'
            AND closing_operator_id IS NOT NULL
            AND closed_at IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX cash_sessions_open_register_uidx
      ON cash_sessions (tenant_id, cash_register_id)
      WHERE status = 'open'
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX cash_sessions_open_operator_uidx
      ON cash_sessions (tenant_id, opening_operator_id)
      WHERE status = 'open'
    `.execute(db)

    await sql`
      CREATE INDEX cash_sessions_tenant_time_idx
      ON cash_sessions (tenant_id, opened_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE cash_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        movement_type text NOT NULL CHECK (
          movement_type IN (
            'opening',
            'sale',
            'sale_reversal',
            'return',
            'supply',
            'withdrawal',
            'closing_adjustment'
          )
        ),
        payment_method text NOT NULL
          CHECK (payment_method IN ('cash', 'credit', 'debit', 'pix')),
        amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
        source_type text NOT NULL,
        source_id uuid,
        actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reason text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        reversal_of_id uuid REFERENCES cash_movements(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (movement_type IN ('opening', 'sale', 'supply') AND amount_cents > 0)
          OR
          (movement_type IN ('sale_reversal', 'return', 'withdrawal') AND amount_cents < 0)
          OR movement_type = 'closing_adjustment'
        ),
        CHECK (
          movement_type NOT IN ('opening', 'supply', 'withdrawal')
          OR payment_method = 'cash'
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX cash_movements_session_time_idx
      ON cash_movements (tenant_id, cash_session_id, occurred_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE cash_close_counts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        payment_method text NOT NULL
          CHECK (payment_method IN ('cash', 'credit', 'debit', 'pix')),
        expected_amount_cents bigint NOT NULL,
        counted_amount_cents bigint NOT NULL CHECK (counted_amount_cents >= 0),
        difference_cents bigint NOT NULL,
        actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        counted_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, cash_session_id, payment_method),
        CHECK (difference_cents = counted_amount_cents - expected_amount_cents)
      )
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS cash_close_counts`.execute(db)
    await sql`DROP TABLE IF EXISTS cash_movements`.execute(db)
    await sql`DROP TABLE IF EXISTS cash_sessions`.execute(db)
    await sql`DROP TABLE IF EXISTS cash_register_assignments`.execute(db)
    await sql`DROP TABLE IF EXISTS cash_registers`.execute(db)
  },
}
