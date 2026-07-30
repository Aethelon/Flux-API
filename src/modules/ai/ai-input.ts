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

export function compactAiValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const compacted = value.map(compactAiValue)
    if (compacted.length <= 24) return compacted
    const numbers = compacted.filter(
      (item): item is number => typeof item === "number" && Number.isFinite(item),
    )
    if (numbers.length === compacted.length) {
      const total = numbers.reduce((sum, item) => sum + item, 0)
      return {
        observationCount: numbers.length,
        minimum: Math.min(...numbers),
        maximum: Math.max(...numbers),
        total,
        average: total / numbers.length,
        first: numbers[0],
        last: numbers.at(-1),
      }
    }
    return compacted.slice(0, 24)
  }
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "backtestByHorizon" && key !== "byHorizon")
      .map(([key, nested]) => [key, compactAiValue(nested)]),
  )
}

function compactInventoryEvidence(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return compactAiValue(value)
  }
  const evidence = value as Record<string, unknown>
  const selected = [
    "dataWindow",
    "trendSlope",
    "limitations",
    "completeness",
    "costTurnover",
    "unitTurnover",
    "pricingInputs",
    "stockoutAffected",
  ]
  const result = Object.fromEntries(
    selected.flatMap((key) => key in evidence
      ? [[key, compactAiValue(evidence[key])]]
      : []),
  )
  if (
    typeof evidence.replenishment === "object"
    && evidence.replenishment !== null
    && !Array.isArray(evidence.replenishment)
  ) {
    const replenishment = evidence.replenishment as Record<string, unknown>
    result.replenishment = Object.fromEntries([
      "daysOfCover",
      "leadTimeDays",
      "reorderPoint",
      "finalSuggestion",
      "meanDailyDemand",
      "inventoryPosition",
      "stockoutProbability",
    ].flatMap((key) => key in replenishment
      ? [[key, replenishment[key]]]
      : []))
  }
  if ("promotion" in evidence) {
    result.promotion = compactAiValue(evidence.promotion)
  }
  return result
}

function compactRecommendationEvidence(value: unknown): unknown {
  const compacted = compactInventoryEvidence(value)
  if (typeof compacted !== "object" || compacted === null || Array.isArray(compacted)) {
    return compacted
  }
  const evidence = compacted as Record<string, unknown>
  return Object.fromEntries([
    "trendSlope",
    "unitTurnover",
    "costTurnover",
    "stockoutAffected",
    "replenishment",
    "promotion",
  ].flatMap((key) => key in evidence ? [[key, evidence[key]]] : []))
}

function compactForecastMetrics(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return compactAiValue(value)
  }
  const metrics = value as Record<string, unknown>
  const selected = ["mae", "rmse", "wape", "bias", "rSquared"]
  const result = Object.fromEntries(
    selected.flatMap((key) => key in metrics ? [[key, metrics[key]]] : []),
  )
  if (
    typeof metrics.backtest === "object"
    && metrics.backtest !== null
    && !Array.isArray(metrics.backtest)
  ) {
    const backtest = metrics.backtest as Record<string, unknown>
    result.backtest = Object.fromEntries(
      selected.flatMap((key) => key in backtest ? [[key, backtest[key]]] : []),
    )
  }
  return result
}

function latestMetricRows<T extends {
  metric_key: string
  entity_type: string
  entity_id: string | null
}>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.metric_key}:${row.entity_type}:${row.entity_id ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 50)
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100)
}

export function metricResultForAi(
  metricKey: string,
  sourceFrom: Date,
  value: unknown,
): unknown {
  if (
    (metricKey !== "monthly_net_revenue" && metricKey !== "monthly_product_demand")
    || typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) return compactAiValue(value)
  const result = value as Record<string, unknown>
  if (
    !Array.isArray(result.eligibleValues)
    || !result.eligibleValues.every(
      (item): item is number => typeof item === "number" && Number.isFinite(item),
    )
  ) return compactAiValue(value)
  const months = result.eligibleValues.map((_, index) => {
    const month = new Date(Date.UTC(
      sourceFrom.getUTCFullYear(),
      sourceFrom.getUTCMonth() + index,
      1,
    ))
    return month.toISOString().slice(0, 7)
  })
  return {
    months,
    [metricKey === "monthly_net_revenue" ? "netRevenueCents" : "units"]:
      result.eligibleValues,
    ...(metricKey === "monthly_net_revenue"
      ? { netRevenueBrl: result.eligibleValues.map(formatBrl) }
      : {}),
  }
}

export async function buildSanitizedAiInput(
  database: Kysely<Database>,
  tenantId: string,
): Promise<SanitizedAiInput> {
  const settings = await database.selectFrom("tenant_settings").select([
    "timezone",
    "currency",
  ]).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()
  const metricRows = latestMetricRows(await database.selectFrom("metric_snapshots as metric")
    .leftJoin("products as product", (join) => join
      .onRef("product.id", "=", "metric.entity_id")
      .onRef("product.tenant_id", "=", "metric.tenant_id"))
    .select([
      "metric.id",
      "metric.metric_key",
      "metric.entity_type",
      "metric.entity_id",
      "product.name as entity_name",
      "metric.calculation_version",
      "metric.source_from",
      "metric.source_to",
      "metric.result",
      "metric.completeness",
      "metric.generated_at",
    ]).where("metric.tenant_id", "=", tenantId)
    .where("metric.published", "=", true)
    .orderBy("metric.generated_at", "desc").orderBy("metric.id", "desc")
    .limit(100).execute())
  const availableForecastRows = await database.selectFrom("forecast_runs as forecast")
    .leftJoin("products as product", (join) => join
      .onRef("product.id", "=", "forecast.product_id")
      .onRef("product.tenant_id", "=", "forecast.tenant_id"))
    .select([
      "forecast.id",
      "forecast.target_type",
      "forecast.product_id",
      "product.name as product_name",
      "forecast.method",
      "forecast.calculation_version",
      "forecast.training_from",
      "forecast.training_to",
      "forecast.model_metrics",
      "forecast.baseline_metrics",
      "forecast.confidence_score",
      "forecast.confidence_label",
      "forecast.limitations",
      "forecast.source_snapshot_ids",
      "forecast.created_at",
    ]).where("forecast.tenant_id", "=", tenantId)
    .where("forecast.published", "=", true)
    .orderBy("forecast.created_at", "desc").orderBy("forecast.id", "desc")
    .limit(20).execute()
  const forecastRows = [
    ...availableForecastRows.filter((row) => row.target_type === "monthly_revenue").slice(0, 1),
    ...availableForecastRows.filter((row) => row.target_type === "product_demand").slice(0, 5),
  ]
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
        productName: row.product_name,
        unit: row.target_type === "monthly_revenue" ? "BRL_CENTS" : "UNITS",
        method: row.method,
        calculationVersion: row.calculation_version,
        trainingFrom: row.training_from.toISOString(),
        trainingTo: row.training_to.toISOString(),
        modelMetrics: compactForecastMetrics(row.model_metrics),
        baselineMetrics: compactForecastMetrics(row.baseline_metrics),
        confidenceScore: row.confidence_score === null
          ? null : Number(row.confidence_score),
        confidenceLabel: row.confidence_label,
        limitations: compactAiValue(row.limitations),
        sourceMetricIds: stringArray(row.source_snapshot_ids),
        points: points.map((point) => ({
          bucketStart: point.bucket_start,
          horizon: point.horizon,
          pointEstimate: Number(point.point_estimate),
          pointEstimateDisplay: row.target_type === "monthly_revenue"
            ? formatBrl(Number(point.point_estimate))
            : `${String(Number(point.point_estimate))} unidades`,
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
    .innerJoin("products as product", (join) => join
      .onRef("product.id", "=", "recommendation.product_id")
      .onRef("product.tenant_id", "=", "recommendation.tenant_id"))
    .select([
      "recommendation.id",
      "recommendation.recommendation_type",
      "recommendation.product_id",
      "product.name as product_name",
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
    productName: row.product_name,
    calculationVersion: row.calculation_version,
    evidenceMetrics: compactRecommendationEvidence(row.evidence_metrics),
    proposedValue: compactAiValue(row.proposed_value),
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
      entityName: row.entity_name,
      calculationVersion: row.calculation_version,
      sourceFrom: row.source_from.toISOString(),
      sourceTo: row.source_to.toISOString(),
      generatedAt: row.generated_at.toISOString(),
      result: row.metric_key === "inventory_recommendation_evidence"
        ? compactInventoryEvidence(row.result)
        : metricResultForAi(row.metric_key, row.source_from, row.result),
      completeness: compactAiValue(row.completeness),
    })),
    forecasts,
    recommendations,
    limitations: metricRows.length === 0
      ? ["No published deterministic metric snapshots are available."]
      : [],
  }
}
