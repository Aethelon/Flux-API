import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const operationalHardeningMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE outbox_events
      ADD COLUMN correlation_id text
    `.execute(db)
    await sql`
      ALTER TABLE job_runs
      ADD COLUMN correlation_id text
    `.execute(db)

    await sql`
      CREATE INDEX job_runs_stale_processing_idx
      ON job_runs (started_at, id)
      WHERE status = 'processing'
    `.execute(db)
    await sql`
      CREATE INDEX auth_sessions_expiry_idx
      ON auth_sessions (expires_at, id)
    `.execute(db)

    await sql`
      CREATE TABLE backup_restore_checks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status text NOT NULL CHECK (status IN ('passed', 'failed')),
        source_database_hash char(64) NOT NULL,
        source_schema_version text,
        restored_schema_version text,
        row_counts_match boolean NOT NULL,
        backup_started_at timestamptz NOT NULL,
        restore_finished_at timestamptz NOT NULL,
        restore_duration_ms bigint NOT NULL CHECK (restore_duration_ms >= 0),
        error_class text,
        details jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (status = 'passed'
            AND row_counts_match = true
            AND error_class IS NULL)
          OR
          (status = 'failed' AND error_class IS NOT NULL)
        )
      )
    `.execute(db)
    await sql`
      CREATE INDEX backup_restore_checks_time_idx
      ON backup_restore_checks (created_at DESC, id DESC)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS backup_restore_checks`.execute(db)
    await sql`DROP INDEX IF EXISTS auth_sessions_expiry_idx`.execute(db)
    await sql`DROP INDEX IF EXISTS job_runs_stale_processing_idx`.execute(db)
    await sql`ALTER TABLE job_runs DROP COLUMN correlation_id`.execute(db)
    await sql`ALTER TABLE outbox_events DROP COLUMN correlation_id`.execute(db)
  },
}
