import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const historyDashboardExportsMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE job_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        job_type text NOT NULL CHECK (job_type = 'export'),
        status text NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'processing', 'completed', 'failed')
        ),
        requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        parameters jsonb NOT NULL,
        cursor jsonb,
        total_count integer CHECK (total_count IS NULL OR total_count >= 0),
        processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        error_class text,
        error_message text,
        available_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (status = 'pending' AND started_at IS NULL AND finished_at IS NULL)
          OR
          (status = 'processing' AND started_at IS NOT NULL AND finished_at IS NULL)
          OR
          (status IN ('completed', 'failed')
            AND started_at IS NOT NULL
            AND finished_at IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX job_runs_pending_idx
      ON job_runs (available_at, created_at, id)
      WHERE status IN ('pending', 'failed')
    `.execute(db)

    await sql`
      CREATE INDEX job_runs_tenant_time_idx
      ON job_runs (tenant_id, created_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE export_artifacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        job_run_id uuid NOT NULL UNIQUE REFERENCES job_runs(id) ON DELETE RESTRICT,
        filename text NOT NULL,
        content_type text NOT NULL CHECK (content_type = 'text/csv; charset=utf-8'),
        content text NOT NULL,
        row_count integer NOT NULL CHECK (row_count >= 0),
        sha256 char(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        CHECK (expires_at > created_at)
      )
    `.execute(db)

    await sql`
      CREATE INDEX export_artifacts_expiry_idx
      ON export_artifacts (expires_at)
    `.execute(db)

    await sql`
      CREATE INDEX sale_items_sale_history_idx
      ON sale_items (tenant_id, sale_id, id)
    `.execute(db)

    await sql`
      CREATE INDEX service_orders_completion_time_idx
      ON service_orders (tenant_id, completed_at DESC, id DESC)
      WHERE current_status = 'completed'
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS service_orders_completion_time_idx`.execute(db)
    await sql`DROP INDEX IF EXISTS sale_items_sale_history_idx`.execute(db)
    await sql`DROP TABLE IF EXISTS export_artifacts`.execute(db)
    await sql`DROP TABLE IF EXISTS job_runs`.execute(db)
  },
}
