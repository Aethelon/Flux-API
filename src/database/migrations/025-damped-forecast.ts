import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const dampedForecastMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE forecast_runs
      DROP CONSTRAINT forecast_runs_method_check
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_method_check
      CHECK (
        method IN (
          'ols_trend',
          'seasonal_ols',
          'damped_trend',
          'naive_last_value',
          'unavailable'
        )
      )
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      UPDATE forecast_runs
      SET method = 'naive_last_value'
      WHERE method = 'damped_trend'
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      DROP CONSTRAINT forecast_runs_method_check
    `.execute(db)
    await sql`
      ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_method_check
      CHECK (
        method IN (
          'ols_trend',
          'seasonal_ols',
          'naive_last_value',
          'unavailable'
        )
      )
    `.execute(db)
  },
}
