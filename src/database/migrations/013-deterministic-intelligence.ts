import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const deterministicIntelligenceMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE tenant_settings
      ADD COLUMN forecast_horizon integer NOT NULL DEFAULT 6
        CHECK (forecast_horizon BETWEEN 1 AND 24),
      ADD COLUMN forecast_minimum_buckets integer NOT NULL DEFAULT 3
        CHECK (forecast_minimum_buckets >= 3),
      ADD COLUMN forecast_preferred_buckets integer NOT NULL DEFAULT 12
        CHECK (forecast_preferred_buckets >= forecast_minimum_buckets),
      ADD COLUMN forecast_seasonal_cycle integer NOT NULL DEFAULT 12
        CHECK (forecast_seasonal_cycle >= 2),
      ADD COLUMN forecast_baseline_tolerance numeric(8, 6) NOT NULL DEFAULT 0.05
        CHECK (forecast_baseline_tolerance BETWEEN 0 AND 1),
      ADD COLUMN stockout_exclusion_rate numeric(8, 6) NOT NULL DEFAULT 0.5
        CHECK (stockout_exclusion_rate BETWEEN 0 AND 1),
      ADD COLUMN service_level numeric(8, 6) NOT NULL DEFAULT 0.95
        CHECK (service_level IN (0.90, 0.95, 0.975, 0.99)),
      ADD COLUMN review_period_days integer NOT NULL DEFAULT 14
        CHECK (review_period_days >= 1),
      ADD COLUMN demand_window_days integer NOT NULL DEFAULT 90
        CHECK (demand_window_days BETWEEN 30 AND 730),
      ADD COLUMN promotion_overstock_threshold numeric(8, 6) NOT NULL DEFAULT 0.20
        CHECK (promotion_overstock_threshold BETWEEN 0 AND 10),
      ADD COLUMN promotion_turnover_threshold numeric(12, 6) NOT NULL DEFAULT 1
        CHECK (promotion_turnover_threshold >= 0),
      ADD COLUMN promotion_cap numeric(8, 6) NOT NULL DEFAULT 0.30
        CHECK (promotion_cap BETWEEN 0 AND 1),
      ADD COLUMN promotion_coefficient numeric(8, 6) NOT NULL DEFAULT 0.50
        CHECK (promotion_coefficient >= 0),
      ADD COLUMN minimum_gross_margin numeric(8, 6) NOT NULL DEFAULT 0.20
        CHECK (minimum_gross_margin BETWEEN 0 AND 0.99)
    `.execute(db)

    await sql`
      ALTER TABLE job_runs
      DROP CONSTRAINT job_runs_job_type_check
    `.execute(db)
    await sql`
      ALTER TABLE job_runs
      ADD CONSTRAINT job_runs_job_type_check CHECK (
        job_type IN ('export', 'analytics')
      )
    `.execute(db)

    await sql`
      CREATE TABLE business_calendar_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name text NOT NULL,
        recurring_key text,
        starts_on date NOT NULL,
        ends_on date NOT NULL,
        product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
        category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
        source text NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz,
        CHECK (ends_on >= starts_on),
        CHECK (NOT (product_id IS NOT NULL AND category_id IS NOT NULL))
      )
    `.execute(db)

    await sql`
      CREATE INDEX business_calendar_events_period_idx
      ON business_calendar_events (tenant_id, starts_on, ends_on, id)
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE metric_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        metric_key text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid,
        calculation_version text NOT NULL,
        source_from timestamptz NOT NULL,
        source_to timestamptz NOT NULL,
        source_ids jsonb NOT NULL,
        configuration jsonb NOT NULL,
        inputs jsonb NOT NULL,
        result jsonb NOT NULL,
        completeness jsonb NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        published boolean NOT NULL DEFAULT false,
        CHECK (source_to > source_from)
      )
    `.execute(db)

    await sql`
      CREATE INDEX metric_snapshots_tenant_time_idx
      ON metric_snapshots (tenant_id, generated_at DESC, id DESC)
    `.execute(db)
    await sql`
      CREATE INDEX metric_snapshots_entity_idx
      ON metric_snapshots (
        tenant_id,
        entity_type,
        entity_id,
        metric_key,
        generated_at DESC,
        id DESC
      )
    `.execute(db)

    await sql`
      CREATE TABLE forecast_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        target_type text NOT NULL CHECK (
          target_type IN ('product_demand', 'monthly_revenue')
        ),
        product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
        method text NOT NULL CHECK (
          method IN ('ols_trend', 'seasonal_ols', 'naive_last_value', 'unavailable')
        ),
        calculation_version text NOT NULL,
        configuration jsonb NOT NULL,
        training_from timestamptz NOT NULL,
        training_to timestamptz NOT NULL,
        bucket_count integer NOT NULL CHECK (bucket_count >= 0),
        eligible_bucket_count integer NOT NULL CHECK (eligible_bucket_count >= 0),
        data_quality jsonb NOT NULL,
        model_metrics jsonb NOT NULL,
        baseline_metrics jsonb NOT NULL,
        confidence_score numeric(8, 4) CHECK (
          confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100
        ),
        confidence_label text NOT NULL CHECK (
          confidence_label IN ('high', 'medium', 'low', 'unavailable')
        ),
        status text NOT NULL CHECK (
          status IN (
            'completed',
            'insufficient_data',
            'poor_data_quality',
            'baseline_not_beaten'
          )
        ),
        limitations jsonb NOT NULL,
        source_snapshot_ids jsonb NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        published boolean NOT NULL DEFAULT false,
        CHECK (
          (target_type = 'product_demand' AND product_id IS NOT NULL)
          OR (target_type = 'monthly_revenue' AND product_id IS NULL)
        ),
        CHECK (training_to > training_from)
      )
    `.execute(db)

    await sql`
      CREATE INDEX forecast_runs_tenant_time_idx
      ON forecast_runs (tenant_id, created_at DESC, id DESC)
    `.execute(db)
    await sql`
      CREATE INDEX forecast_runs_product_idx
      ON forecast_runs (tenant_id, product_id, created_at DESC, id DESC)
      WHERE product_id IS NOT NULL
    `.execute(db)
    await sql`
      CREATE UNIQUE INDEX forecast_runs_published_product_uidx
      ON forecast_runs (tenant_id, target_type, product_id)
      WHERE published AND product_id IS NOT NULL
    `.execute(db)
    await sql`
      CREATE UNIQUE INDEX forecast_runs_published_revenue_uidx
      ON forecast_runs (tenant_id, target_type)
      WHERE published AND product_id IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE forecast_points (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        forecast_run_id uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE RESTRICT,
        bucket_start date NOT NULL,
        horizon integer NOT NULL CHECK (horizon > 0),
        point_estimate numeric(24, 6) NOT NULL CHECK (point_estimate >= 0),
        lower_limit numeric(24, 6) CHECK (lower_limit IS NULL OR lower_limit >= 0),
        upper_limit numeric(24, 6) CHECK (upper_limit IS NULL OR upper_limit >= 0),
        seasonal_factor numeric(12, 8) CHECK (
          seasonal_factor IS NULL OR seasonal_factor > 0
        ),
        operational_value numeric(24, 6) NOT NULL CHECK (operational_value >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, forecast_run_id, horizon)
      )
    `.execute(db)

    await sql`
      CREATE TABLE forecast_backtests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        forecast_run_id uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE RESTRICT,
        origin_bucket date NOT NULL,
        horizon integer NOT NULL CHECK (horizon > 0),
        actual numeric(24, 6) NOT NULL CHECK (actual >= 0),
        predicted numeric(24, 6) NOT NULL CHECK (predicted >= 0),
        naive_predicted numeric(24, 6) NOT NULL CHECK (naive_predicted >= 0),
        residual numeric(24, 6) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)

    await sql`
      CREATE INDEX forecast_backtests_run_idx
      ON forecast_backtests (tenant_id, forecast_run_id, origin_bucket, horizon)
    `.execute(db)

    await sql`
      CREATE TABLE recommendation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        calculation_version text NOT NULL,
        configuration jsonb NOT NULL,
        source_snapshot_ids jsonb NOT NULL,
        status text NOT NULL CHECK (
          status IN ('completed', 'poor_data_quality', 'insufficient_data')
        ),
        counts jsonb NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)

    await sql`
      CREATE INDEX recommendation_runs_tenant_time_idx
      ON recommendation_runs (tenant_id, created_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE TABLE recommendations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        recommendation_run_id uuid NOT NULL
          REFERENCES recommendation_runs(id) ON DELETE RESTRICT,
        recommendation_type text NOT NULL CHECK (
          recommendation_type IN ('replenishment', 'promotion', 'overstock_review')
        ),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        evidence_metrics jsonb NOT NULL,
        proposed_value jsonb NOT NULL,
        confidence_score numeric(8, 4) CHECK (
          confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100
        ),
        confidence_label text NOT NULL CHECK (
          confidence_label IN ('high', 'medium', 'low', 'unavailable')
        ),
        state text NOT NULL DEFAULT 'pending' CHECK (
          state IN ('pending', 'accepted', 'rejected')
        ),
        reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        reviewed_at timestamptz,
        review_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
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
      CREATE INDEX recommendations_tenant_time_idx
      ON recommendations (tenant_id, created_at DESC, id DESC)
    `.execute(db)
    await sql`
      CREATE INDEX recommendations_product_idx
      ON recommendations (
        tenant_id,
        product_id,
        recommendation_type,
        created_at DESC,
        id DESC
      )
    `.execute(db)

    await sql`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_recommendation_fk
      FOREIGN KEY (recommendation_id)
      REFERENCES recommendations(id)
      ON DELETE RESTRICT
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      UPDATE purchase_orders
      SET recommendation_id = NULL
      WHERE recommendation_id IS NOT NULL
    `.execute(db)
    await sql`
      ALTER TABLE purchase_orders
      DROP CONSTRAINT IF EXISTS purchase_orders_recommendation_fk
    `.execute(db)
    await sql`DROP TABLE IF EXISTS recommendations`.execute(db)
    await sql`DROP TABLE IF EXISTS recommendation_runs`.execute(db)
    await sql`DROP TABLE IF EXISTS forecast_backtests`.execute(db)
    await sql`DROP TABLE IF EXISTS forecast_points`.execute(db)
    await sql`DROP TABLE IF EXISTS forecast_runs`.execute(db)
    await sql`DROP TABLE IF EXISTS metric_snapshots`.execute(db)
    await sql`DROP TABLE IF EXISTS business_calendar_events`.execute(db)
    await sql`
      ALTER TABLE job_runs
      DROP CONSTRAINT job_runs_job_type_check
    `.execute(db)
    await sql`
      DELETE FROM job_runs
      WHERE job_type = 'analytics'
    `.execute(db)
    await sql`
      ALTER TABLE job_runs
      ADD CONSTRAINT job_runs_job_type_check CHECK (job_type = 'export')
    `.execute(db)
    await sql`
      ALTER TABLE tenant_settings
      DROP COLUMN minimum_gross_margin,
      DROP COLUMN promotion_coefficient,
      DROP COLUMN promotion_cap,
      DROP COLUMN promotion_turnover_threshold,
      DROP COLUMN promotion_overstock_threshold,
      DROP COLUMN demand_window_days,
      DROP COLUMN review_period_days,
      DROP COLUMN service_level,
      DROP COLUMN stockout_exclusion_rate,
      DROP COLUMN forecast_baseline_tolerance,
      DROP COLUMN forecast_seasonal_cycle,
      DROP COLUMN forecast_preferred_buckets,
      DROP COLUMN forecast_minimum_buckets,
      DROP COLUMN forecast_horizon
    `.execute(db)
  },
}
