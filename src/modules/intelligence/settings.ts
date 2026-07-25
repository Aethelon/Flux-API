import type { Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import type { AnalyticsSettings } from "./types.js"

export async function analyticsSettings(
  database: Kysely<Database>,
  tenantId: string,
): Promise<AnalyticsSettings> {
  const row = await database.selectFrom("tenant_settings").selectAll()
    .where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()
  return {
    timezone: row.timezone,
    currency: row.currency,
    forecastHorizon: row.forecast_horizon,
    trainingBuckets: row.forecast_training_buckets,
    minimumBuckets: row.forecast_minimum_buckets,
    preferredBuckets: row.forecast_preferred_buckets,
    seasonalCycle: row.forecast_seasonal_cycle,
    baselineTolerance: Number(row.forecast_baseline_tolerance),
    baselinePolicy: row.forecast_baseline_policy,
    confidenceWeights: {
      coverage: Number(row.forecast_confidence_coverage_weight),
      accuracy: Number(row.forecast_confidence_accuracy_weight),
      availability: Number(row.forecast_confidence_availability_weight),
    },
    confidenceThresholds: {
      high: Number(row.forecast_confidence_high_threshold),
      medium: Number(row.forecast_confidence_medium_threshold),
    },
    stockoutExclusionRate: Number(row.stockout_exclusion_rate),
    serviceLevel: Number(row.service_level) as AnalyticsSettings["serviceLevel"],
    reviewPeriodDays: row.review_period_days,
    demandWindowDays: row.demand_window_days,
    promotionOverstockThreshold: Number(row.promotion_overstock_threshold),
    promotionTurnoverThreshold: Number(row.promotion_turnover_threshold),
    promotionCap: Number(row.promotion_cap),
    promotionCoefficient: Number(row.promotion_coefficient),
    minimumGrossMargin: Number(row.minimum_gross_margin),
  }
}
