import type { Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import type {
  SanitizedAiInput,
  SanitizedForecast,
  SanitizedRecommendation,
} from "./types.js"

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export async function buildSanitizedAiInput(
  database: Kysely<Database>,
  tenantId: string,
): Promise<SanitizedAiInput> {
  const settings = await database.selectFrom("tenant_settings").select([
    "timezone",
    "currency",
  ]).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()
  const metricRows = await database.selectFrom("metric_snapshots").select([
    "id",
    "metric_key",
    "entity_type",
    "entity_id",
    "calculation_version",
    "source_from",
    "source_to",
    "result",
    "completeness",
    "generated_at",
  ]).where("tenant_id", "=", tenantId)
    .where("published", "=", true)
    .orderBy("generated_at", "desc").orderBy("id", "desc")
    .limit(50).execute()
  const forecastRows = await database.selectFrom("forecast_runs").select([
    "id",
    "target_type",
    "product_id",
    "method",
    "calculation_version",
    "training_from",
    "training_to",
    "model_metrics",
    "baseline_metrics",
    "confidence_score",
    "confidence_label",
    "limitations",
    "source_snapshot_ids",
    "created_at",
  ]).where("tenant_id", "=", tenantId)
    .where("published", "=", true)
    .orderBy("created_at", "desc").orderBy("id", "desc")
    .limit(10).execute()
  const forecasts: SanitizedForecast[] = await Promise.all(
    forecastRows.map(async (row) => {
      const points = await database.selectFrom("forecast_points").select([
        "bucket_start",
        "horizon",
        "point_estimate",
        "lower_limit",
        "upper_limit",
      ]).where("tenant_id", "=", tenantId)
        .where("forecast_run_id", "=", row.id)
        .orderBy("horizon").execute()
      return {
        id: row.id,
        targetType: row.target_type,
        productId: row.product_id,
        method: row.method,
        calculationVersion: row.calculation_version,
        trainingFrom: row.training_from.toISOString(),
        trainingTo: row.training_to.toISOString(),
        modelMetrics: row.model_metrics,
        baselineMetrics: row.baseline_metrics,
        confidenceScore: row.confidence_score === null
          ? null : Number(row.confidence_score),
        confidenceLabel: row.confidence_label,
        limitations: row.limitations,
        sourceMetricIds: stringArray(row.source_snapshot_ids),
        points: points.map((point) => ({
          bucketStart: point.bucket_start,
          horizon: point.horizon,
          pointEstimate: Number(point.point_estimate),
          lowerLimit: point.lower_limit === null ? null : Number(point.lower_limit),
          upperLimit: point.upper_limit === null ? null : Number(point.upper_limit),
        })),
      }
    }),
  )
  const recommendationRows = await database.selectFrom("recommendations as recommendation")
    .innerJoin("recommendation_runs as run", (join) => join
      .onRef("run.id", "=", "recommendation.recommendation_run_id")
      .onRef("run.tenant_id", "=", "recommendation.tenant_id"))
    .select([
      "recommendation.id",
      "recommendation.recommendation_type",
      "recommendation.product_id",
      "recommendation.evidence_metrics",
      "recommendation.proposed_value",
      "recommendation.confidence_score",
      "recommendation.confidence_label",
      "recommendation.created_at",
      "run.calculation_version",
      "run.source_snapshot_ids",
    ]).where("recommendation.tenant_id", "=", tenantId)
    .where("recommendation.state", "in", ["pending", "accepted"])
    .orderBy("recommendation.created_at", "desc")
    .orderBy("recommendation.id", "desc")
    .limit(20).execute()
  const recommendations: SanitizedRecommendation[] = recommendationRows.map((row) => ({
    id: row.id,
    type: row.recommendation_type,
    productId: row.product_id,
    calculationVersion: row.calculation_version,
    evidenceMetrics: row.evidence_metrics,
    proposedValue: row.proposed_value,
    confidenceScore: row.confidence_score === null
      ? null : Number(row.confidence_score),
    confidenceLabel: row.confidence_label,
    sourceMetricIds: stringArray(row.source_snapshot_ids),
  }))
  const latestDates = [
    ...metricRows.map((row) => row.generated_at.getTime()),
    ...forecastRows.map((row) => row.created_at.getTime()),
    ...recommendationRows.map((row) => row.created_at.getTime()),
  ]
  return {
    context: {
      businessType: "retail_and_production",
      timezone: settings.timezone,
      currency: settings.currency,
    },
    generatedAt: new Date(
      latestDates.length > 0 ? Math.max(...latestDates) : 0,
    ).toISOString(),
    metrics: metricRows.map((row) => ({
      id: row.id,
      key: row.metric_key,
      entityType: row.entity_type,
      entityId: row.entity_id,
      calculationVersion: row.calculation_version,
      sourceFrom: row.source_from.toISOString(),
      sourceTo: row.source_to.toISOString(),
      generatedAt: row.generated_at.toISOString(),
      result: row.result,
      completeness: row.completeness,
    })),
    forecasts,
    recommendations,
    limitations: metricRows.length === 0
      ? ["No published deterministic metric snapshots are available."]
      : [],
  }
}
