import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const intelligenceHardeningMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE categories
      ADD CONSTRAINT categories_tenant_id_id_unique UNIQUE (tenant_id, id)
    `.execute(db)

    await sql`
      ALTER TABLE tenant_settings
      ADD COLUMN forecast_training_buckets integer NOT NULL DEFAULT 24
        CHECK (forecast_training_buckets >= 3),
      ADD COLUMN forecast_baseline_policy text NOT NULL DEFAULT 'naive'
        CHECK (forecast_baseline_policy IN ('naive', 'reject')),
      ADD COLUMN forecast_confidence_coverage_weight numeric(8, 6)
        NOT NULL DEFAULT 0.35
        CHECK (forecast_confidence_coverage_weight BETWEEN 0 AND 1),
      ADD COLUMN forecast_confidence_accuracy_weight numeric(8, 6)
        NOT NULL DEFAULT 0.45
        CHECK (forecast_confidence_accuracy_weight BETWEEN 0 AND 1),
      ADD COLUMN forecast_confidence_availability_weight numeric(8, 6)
        NOT NULL DEFAULT 0.20
        CHECK (forecast_confidence_availability_weight BETWEEN 0 AND 1),
      ADD COLUMN forecast_confidence_high_threshold numeric(8, 4)
        NOT NULL DEFAULT 75
        CHECK (forecast_confidence_high_threshold BETWEEN 0 AND 100),
      ADD COLUMN forecast_confidence_medium_threshold numeric(8, 4)
        NOT NULL DEFAULT 50
        CHECK (forecast_confidence_medium_threshold BETWEEN 0 AND 100),
      ADD CONSTRAINT tenant_settings_forecast_training_window_check
        CHECK (forecast_training_buckets >= forecast_preferred_buckets),
      ADD CONSTRAINT tenant_settings_forecast_confidence_weights_check
        CHECK (
          forecast_confidence_coverage_weight
          + forecast_confidence_accuracy_weight
          + forecast_confidence_availability_weight = 1
        ),
      ADD CONSTRAINT tenant_settings_forecast_confidence_thresholds_check
        CHECK (
          forecast_confidence_high_threshold
          >= forecast_confidence_medium_threshold
        )
    `.execute(db)

    await sql`
      ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_tenant_id_id_unique UNIQUE (tenant_id, id)
    `.execute(db)
    await sql`
      ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_tenant_id_id_unique UNIQUE (tenant_id, id)
    `.execute(db)
    await sql`
      ALTER TABLE recommendations
      ADD CONSTRAINT recommendations_tenant_id_id_unique UNIQUE (tenant_id, id)
    `.execute(db)

    await sql`
      ALTER TABLE business_calendar_events
      ADD CONSTRAINT business_calendar_events_tenant_product_fk
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES products(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT business_calendar_events_tenant_category_fk
        FOREIGN KEY (tenant_id, category_id)
        REFERENCES categories(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_tenant_product_fk
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES products(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
    await sql`
      ALTER TABLE forecast_points
      ADD CONSTRAINT forecast_points_tenant_run_fk
        FOREIGN KEY (tenant_id, forecast_run_id)
        REFERENCES forecast_runs(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
    await sql`
      ALTER TABLE forecast_backtests
      ADD CONSTRAINT forecast_backtests_tenant_run_fk
        FOREIGN KEY (tenant_id, forecast_run_id)
        REFERENCES forecast_runs(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
    await sql`
      ALTER TABLE recommendations
      ADD CONSTRAINT recommendations_tenant_run_fk
        FOREIGN KEY (tenant_id, recommendation_run_id)
        REFERENCES recommendation_runs(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT recommendations_tenant_product_fk
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES products(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)

    await sql`
      ALTER TABLE purchase_orders
      DROP CONSTRAINT purchase_orders_recommendation_fk,
      ADD CONSTRAINT purchase_orders_recommendation_fk
        FOREIGN KEY (tenant_id, recommendation_id)
        REFERENCES recommendations(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE purchase_orders
      DROP CONSTRAINT purchase_orders_recommendation_fk,
      ADD CONSTRAINT purchase_orders_recommendation_fk
        FOREIGN KEY (recommendation_id)
        REFERENCES recommendations(id) ON DELETE RESTRICT
    `.execute(db)

    await sql`
      ALTER TABLE recommendations
      DROP CONSTRAINT recommendations_tenant_product_fk,
      DROP CONSTRAINT recommendations_tenant_run_fk
    `.execute(db)
    await sql`
      ALTER TABLE forecast_backtests
      DROP CONSTRAINT forecast_backtests_tenant_run_fk
    `.execute(db)
    await sql`
      ALTER TABLE forecast_points
      DROP CONSTRAINT forecast_points_tenant_run_fk
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      DROP CONSTRAINT forecast_runs_tenant_product_fk
    `.execute(db)
    await sql`
      ALTER TABLE business_calendar_events
      DROP CONSTRAINT business_calendar_events_tenant_category_fk,
      DROP CONSTRAINT business_calendar_events_tenant_product_fk
    `.execute(db)

    await sql`
      ALTER TABLE recommendations
      DROP CONSTRAINT recommendations_tenant_id_id_unique
    `.execute(db)
    await sql`
      ALTER TABLE recommendation_runs
      DROP CONSTRAINT recommendation_runs_tenant_id_id_unique
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      DROP CONSTRAINT forecast_runs_tenant_id_id_unique
    `.execute(db)

    await sql`
      ALTER TABLE tenant_settings
      DROP CONSTRAINT tenant_settings_forecast_confidence_thresholds_check,
      DROP CONSTRAINT tenant_settings_forecast_confidence_weights_check,
      DROP CONSTRAINT tenant_settings_forecast_training_window_check,
      DROP COLUMN forecast_confidence_medium_threshold,
      DROP COLUMN forecast_confidence_high_threshold,
      DROP COLUMN forecast_confidence_availability_weight,
      DROP COLUMN forecast_confidence_accuracy_weight,
      DROP COLUMN forecast_confidence_coverage_weight,
      DROP COLUMN forecast_baseline_policy,
      DROP COLUMN forecast_training_buckets
    `.execute(db)

    await sql`
      ALTER TABLE categories
      DROP CONSTRAINT categories_tenant_id_id_unique
    `.execute(db)
  },
}
