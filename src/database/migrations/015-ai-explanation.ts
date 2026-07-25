import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const aiExplanationMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE tenant_settings
      ADD COLUMN ai_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN ai_daily_token_budget integer NOT NULL DEFAULT 100000
        CHECK (ai_daily_token_budget >= 0),
      ADD COLUMN ai_daily_cost_budget_micro_usd bigint NOT NULL DEFAULT 100000
        CHECK (ai_daily_cost_budget_micro_usd >= 0)
    `.execute(db)

    await sql`
      ALTER TABLE job_runs
      DROP CONSTRAINT job_runs_job_type_check,
      ADD CONSTRAINT job_runs_job_type_check CHECK (
        job_type IN ('export', 'analytics', 'ai')
      )
    `.execute(db)

    await sql`
      CREATE TABLE ai_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        job_run_id uuid NOT NULL UNIQUE REFERENCES job_runs(id) ON DELETE RESTRICT,
        provider text NOT NULL CHECK (provider IN ('gemini', 'anthropic')),
        model_id text NOT NULL,
        prompt_version text NOT NULL,
        schema_version text NOT NULL,
        policy_version text NOT NULL,
        input_hash char(64) NOT NULL,
        source_snapshot_ids jsonb NOT NULL,
        sanitized_input jsonb NOT NULL,
        structured_output jsonb,
        status text NOT NULL DEFAULT 'pending' CHECK (
          status IN (
            'pending',
            'processing',
            'completed',
            'cached',
            'rejected',
            'failed',
            'budget_exceeded'
          )
        ),
        validation_outcome text NOT NULL DEFAULT 'pending' CHECK (
          validation_outcome IN ('pending', 'accepted', 'rejected', 'not_run')
        ),
        rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
        provider_request_id text,
        input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
        latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
        estimated_cost_micro_usd bigint CHECK (
          estimated_cost_micro_usd IS NULL OR estimated_cost_micro_usd >= 0
        ),
        retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        cache_source_run_id uuid REFERENCES ai_runs(id) ON DELETE RESTRICT,
        error_class text,
        error_message text,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz,
        UNIQUE (tenant_id, id),
        CHECK (
          (status = 'pending' AND started_at IS NULL AND finished_at IS NULL)
          OR
          (status = 'processing' AND started_at IS NOT NULL AND finished_at IS NULL)
          OR
          (status IN (
            'completed',
            'cached',
            'rejected',
            'failed',
            'budget_exceeded'
          ) AND finished_at IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX ai_runs_tenant_time_idx
      ON ai_runs (tenant_id, created_at DESC, id DESC)
    `.execute(db)
    await sql`
      CREATE INDEX ai_runs_cache_idx
      ON ai_runs (
        tenant_id,
        input_hash,
        prompt_version,
        schema_version,
        policy_version,
        provider,
        model_id,
        created_at DESC,
        id DESC
      )
      WHERE status IN ('completed', 'cached')
    `.execute(db)
    await sql`
      CREATE INDEX ai_runs_daily_budget_idx
      ON ai_runs (tenant_id, created_at)
      WHERE status IN ('completed', 'cached')
    `.execute(db)

    await sql`
      CREATE TABLE ai_insights (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        ai_run_id uuid NOT NULL,
        insight_type text NOT NULL CHECK (
          insight_type IN ('summary', 'strength', 'risk', 'recommendation')
        ),
        text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
        severity text CHECK (severity IN ('low', 'medium', 'high')),
        source_metric_ids jsonb NOT NULL,
        display_order integer NOT NULL CHECK (display_order >= 0),
        requires_human_review boolean NOT NULL DEFAULT true,
        state text NOT NULL DEFAULT 'pending' CHECK (
          state IN ('pending', 'accepted', 'rejected')
        ),
        reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        reviewed_at timestamptz,
        review_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, ai_run_id, insight_type, display_order),
        FOREIGN KEY (tenant_id, ai_run_id)
          REFERENCES ai_runs(tenant_id, id) ON DELETE RESTRICT,
        CHECK (
          (insight_type = 'risk' AND severity IS NOT NULL)
          OR (insight_type <> 'risk' AND severity IS NULL)
        ),
        CHECK (
          (state = 'pending'
            AND reviewer_id IS NULL
            AND reviewed_at IS NULL
            AND review_reason IS NULL)
          OR
          (state IN ('accepted', 'rejected')
            AND reviewer_id IS NOT NULL
            AND reviewed_at IS NOT NULL
            AND review_reason IS NOT NULL)
        )
      )
    `.execute(db)

    await sql`
      CREATE INDEX ai_insights_tenant_time_idx
      ON ai_insights (tenant_id, created_at DESC, id DESC)
    `.execute(db)
    await sql`
      CREATE INDEX ai_insights_review_idx
      ON ai_insights (tenant_id, state, created_at DESC, id DESC)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS ai_insights`.execute(db)
    await sql`DROP TABLE IF EXISTS ai_runs`.execute(db)
    await sql`
      DELETE FROM job_runs
      WHERE job_type = 'ai'
    `.execute(db)
    await sql`
      ALTER TABLE job_runs
      DROP CONSTRAINT job_runs_job_type_check,
      ADD CONSTRAINT job_runs_job_type_check CHECK (
        job_type IN ('export', 'analytics')
      )
    `.execute(db)
    await sql`
      ALTER TABLE tenant_settings
      DROP COLUMN ai_daily_cost_budget_micro_usd,
      DROP COLUMN ai_daily_token_budget,
      DROP COLUMN ai_enabled
    `.execute(db)
  },
}
