import { sql, type Kysely } from "kysely"
import type {
  Database,
  ForecastMethod,
  ForecastStatus,
  ForecastTargetType,
} from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  ANALYTICS_CALCULATION_VERSION,
  confidenceScore,
  forecastDampedTrend,
  fitOls,
  forecastOls,
  hasSufficientBacktestOrigins,
  rollingOriginBacktest,
  seasonalFactors,
} from "./math.js"
import { analyticsSettings } from "./settings.js"
import type { AnalyticalBucket, AnalyticsSettings } from "./types.js"

interface ProductTarget {
  id: string
  name: string
  quantityScale: number
}

interface StoredForecast {
  runId: string
  published: boolean
}

const PRODUCT_FORECAST_LIMIT = 20

function monthAfter(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 10)
}

function roundedOperational(value: number, quantityScale: number | null): number {
  if (quantityScale === null) return Math.round(value)
  const factor = 10 ** quantityScale
  return Math.ceil((value * factor) - 1e-9) / factor
}

async function productBuckets(
  database: Kysely<Database>,
  tenantId: string,
  productId: string,
  settings: AnalyticsSettings,
): Promise<AnalyticalBucket[]> {
  const result = await sql<{
    bucket_start: string
    value: string
    observed_minutes: string
    in_stock_minutes: string
    stockout_minutes: string
    complete: boolean
  }>`
    WITH bounds AS (
      SELECT
        GREATEST(
          COALESCE(
            date_trunc(
              'month',
              MIN(sale.completed_at) AT TIME ZONE ${settings.timezone}
            ),
            date_trunc('month', now() AT TIME ZONE ${settings.timezone})
              - (${settings.minimumBuckets} * interval '1 month')
          ),
          date_trunc('month', now() AT TIME ZONE ${settings.timezone})
            - (${settings.trainingBuckets} * interval '1 month')
        ) AS first_month,
        date_trunc('month', now() AT TIME ZONE ${settings.timezone}) AS end_month
      FROM sale_items AS item
      INNER JOIN sales AS sale
        ON sale.id = item.sale_id
        AND sale.tenant_id = item.tenant_id
      WHERE item.tenant_id = ${tenantId}::uuid
        AND item.product_id = ${productId}::uuid
        AND sale.status <> 'cancelled'
    ),
    buckets AS (
      SELECT generate_series(
        bounds.first_month,
        bounds.end_month - interval '1 month',
        interval '1 month'
      ) AS bucket_start
      FROM bounds
    ),
    demand AS (
      SELECT
        date_trunc(
          'month',
          sale.completed_at AT TIME ZONE ${settings.timezone}
        ) AS bucket_start,
        SUM(item.quantity - item.returned_quantity) AS value
      FROM sale_items AS item
      INNER JOIN sales AS sale
        ON sale.id = item.sale_id
        AND sale.tenant_id = item.tenant_id
      WHERE item.tenant_id = ${tenantId}::uuid
        AND item.product_id = ${productId}::uuid
        AND sale.status <> 'cancelled'
      GROUP BY bucket_start
    ),
    availability AS (
      SELECT
        date_trunc('month', snapshot.local_date::timestamp) AS bucket_start,
        SUM(snapshot.observed_minutes) AS observed_minutes,
        SUM(snapshot.in_stock_minutes) AS in_stock_minutes,
        SUM(snapshot.stockout_minutes) AS stockout_minutes,
        BOOL_AND(snapshot.complete) AS complete
      FROM inventory_daily_snapshots AS snapshot
      WHERE snapshot.tenant_id = ${tenantId}::uuid
        AND snapshot.product_id = ${productId}::uuid
      GROUP BY bucket_start
    )
    SELECT
      to_char(buckets.bucket_start, 'YYYY-MM-DD') AS bucket_start,
      COALESCE(demand.value, 0)::text AS value,
      COALESCE(availability.observed_minutes, 0)::text AS observed_minutes,
      COALESCE(availability.in_stock_minutes, 0)::text AS in_stock_minutes,
      COALESCE(availability.stockout_minutes, 0)::text AS stockout_minutes,
      COALESCE(availability.complete, false) AS complete
    FROM buckets
    LEFT JOIN demand USING (bucket_start)
    LEFT JOIN availability USING (bucket_start)
    ORDER BY buckets.bucket_start
  `.execute(database)

  return result.rows.map((row) => {
    const observedMinutes = Number(row.observed_minutes)
    const availabilityUnobserved = observedMinutes === 0
    const stockoutRate = observedMinutes === 0
      ? 1
      : Number(row.stockout_minutes) / observedMinutes
    const exclusionReason = availabilityUnobserved
      ? "inventory_availability_unobserved"
      : !row.complete
        ? "incomplete_inventory_snapshot"
        : stockoutRate > settings.stockoutExclusionRate
          ? "excessive_stockout_coverage"
          : null
    return {
      bucketStart: row.bucket_start,
      value: Number(row.value),
      eligible: availabilityUnobserved || exclusionReason === null,
      exclusionReason,
      observedMinutes,
      inStockMinutes: Number(row.in_stock_minutes),
      stockoutMinutes: Number(row.stockout_minutes),
    }
  })
}

async function revenueBuckets(
  database: Kysely<Database>,
  tenantId: string,
  settings: AnalyticsSettings,
): Promise<AnalyticalBucket[]> {
  const result = await sql<{ bucket_start: string; value: string }>`
    WITH bounds AS (
      SELECT
        GREATEST(
          COALESCE(
            date_trunc(
              'month',
              MIN(completed_at) AT TIME ZONE ${settings.timezone}
            ),
            date_trunc('month', now() AT TIME ZONE ${settings.timezone})
              - (${settings.minimumBuckets} * interval '1 month')
          ),
          date_trunc('month', now() AT TIME ZONE ${settings.timezone})
            - (${settings.trainingBuckets} * interval '1 month')
        ) AS first_month,
        date_trunc('month', now() AT TIME ZONE ${settings.timezone}) AS end_month
      FROM sales
      WHERE tenant_id = ${tenantId}::uuid
        AND status <> 'cancelled'
    ),
    buckets AS (
      SELECT generate_series(
        bounds.first_month,
        bounds.end_month - interval '1 month',
        interval '1 month'
      ) AS bucket_start
      FROM bounds
    ),
    revenue AS (
      SELECT bucket_start, SUM(amount_cents) AS amount_cents
      FROM (
        SELECT
          date_trunc(
            'month',
            sale.completed_at AT TIME ZONE ${settings.timezone}
          ) AS bucket_start,
          SUM(sale.net_amount_cents) AS amount_cents
        FROM sales AS sale
        WHERE sale.tenant_id = ${tenantId}::uuid
          AND sale.status <> 'cancelled'
        GROUP BY bucket_start
        UNION ALL
        SELECT
          date_trunc(
            'month',
            sale_return.completed_at AT TIME ZONE ${settings.timezone}
          ) AS bucket_start,
          -SUM(sale_return.total_amount_cents) AS amount_cents
        FROM sale_returns AS sale_return
        INNER JOIN sales AS original_sale
          ON original_sale.id = sale_return.sale_id
          AND original_sale.tenant_id = sale_return.tenant_id
        WHERE sale_return.tenant_id = ${tenantId}::uuid
          AND original_sale.status <> 'cancelled'
        GROUP BY bucket_start
      ) AS facts
      GROUP BY bucket_start
    )
    SELECT
      to_char(buckets.bucket_start, 'YYYY-MM-DD') AS bucket_start,
      GREATEST(0, COALESCE(revenue.amount_cents, 0))::text AS value
    FROM buckets
    LEFT JOIN revenue USING (bucket_start)
    ORDER BY buckets.bucket_start
  `.execute(database)
  return result.rows.map((row) => ({
    bucketStart: row.bucket_start,
    value: Number(row.value),
    eligible: true,
    exclusionReason: null,
    observedMinutes: 1,
    inStockMinutes: 1,
    stockoutMinutes: 0,
  }))
}

async function persistForecast(
  database: Kysely<Database>,
  input: {
    tenantId: string
    actorId: string
    targetType: ForecastTargetType
    product: ProductTarget | null
    settings: AnalyticsSettings
    buckets: AnalyticalBucket[]
  },
): Promise<StoredForecast> {
  const firstBucket = input.buckets[0]?.bucketStart
    ?? monthAfter(new Date().toISOString().slice(0, 10), -1)
  const lastBucket = input.buckets.at(-1)?.bucketStart ?? firstBucket
  const trainingFrom = new Date(`${firstBucket}T00:00:00.000Z`)
  const trainingTo = new Date(`${monthAfter(lastBucket, 1)}T00:00:00.000Z`)
  const eligible = input.buckets.filter((bucket) => bucket.eligible)
  const values = eligible.map((bucket) => bucket.value)
  const totalObserved = input.buckets.reduce(
    (total, bucket) => total + bucket.observedMinutes,
    0,
  )
  const totalInStock = input.buckets.reduce(
    (total, bucket) => total + bucket.inStockMinutes,
    0,
  )
  const availabilityScore = totalObserved === 0 ? 0 : totalInStock / totalObserved
  const fit = fitOls(values)
  const backtest = rollingOriginBacktest(
    values,
    input.settings.minimumBuckets,
    input.settings.forecastHorizon,
  )
  const modelWape = backtest?.model.wape ?? null
  const baselineWape = backtest?.baseline.wape ?? null
  const baselineBeaten = modelWape !== null
    && baselineWape !== null
    && modelWape <= baselineWape * (1 + input.settings.baselineTolerance)
  const backtestOrigins = new Set(backtest?.points.map((point) => point.origin) ?? []).size
  const baselineValidated = baselineBeaten && hasSufficientBacktestOrigins(backtest)
  const trendReliability = baselineValidated
    ? 1
    : Math.min(1, backtestOrigins / 3)
      * Math.max(0, Math.min(1, fit?.metrics.rSquared ?? 0))
  const rawConfidence = fit
    ? confidenceScore({
        eligibleBucketCount: eligible.length,
        preferredBucketCount: input.settings.preferredBuckets,
        backtestWape: modelWape,
        availabilityScore,
        baselineBeaten: baselineValidated,
        weights: input.settings.confidenceWeights,
        thresholds: input.settings.confidenceThresholds,
      })
    : null
  const confidence = rawConfidence && !baselineValidated
    ? {
        score: Math.min(
          rawConfidence.score,
          input.settings.confidenceThresholds.medium - 1,
        ),
        label: "low" as const,
      }
    : rawConfidence
  let method: ForecastMethod = "unavailable"
  const status: ForecastStatus = eligible.length < input.settings.minimumBuckets
    ? input.buckets.length >= input.settings.minimumBuckets
      ? "poor_data_quality"
      : "insufficient_data"
    : fit
      ? "completed"
      : "insufficient_data"
  const limitations = input.buckets
    .filter((bucket) => bucket.exclusionReason !== null)
    .map((bucket) => ({
      bucketStart: bucket.bucketStart,
      reason: bucket.exclusionReason,
    }))
  const seasonal = fit
    ? seasonalFactors(
        values,
        fit,
        eligible.map((bucket) => new Date(`${bucket.bucketStart}T00:00:00Z`).getUTCMonth()),
        input.settings.seasonalCycle,
      )
    : { factors: [], enabled: false, reason: "forecast_unavailable" }
  if (fit) {
    method = baselineValidated
      ? seasonal.enabled ? "seasonal_ols" : "ols_trend"
      : backtest && input.settings.baselinePolicy === "naive"
        ? "damped_trend"
        : "ols_trend"
    if (!baselineBeaten && backtest) {
      limitations.push({
        bucketStart: lastBucket,
        reason: "regression_baseline_not_beaten",
      })
    }
  }
  const effectiveStatus = !baselineValidated
    && backtest
    && input.settings.baselinePolicy === "reject"
    ? "baseline_not_beaten"
    : status
  const published = effectiveStatus === "completed"
  const configuration = {
    horizon: input.settings.forecastHorizon,
    trainingBuckets: input.settings.trainingBuckets,
    minimumBuckets: input.settings.minimumBuckets,
    preferredBuckets: input.settings.preferredBuckets,
    seasonalCycle: input.settings.seasonalCycle,
    baselineTolerance: input.settings.baselineTolerance,
    stockoutExclusionRate: input.settings.stockoutExclusionRate,
    baselinePolicy: input.settings.baselinePolicy,
    confidenceWeights: input.settings.confidenceWeights,
    confidenceThresholds: input.settings.confidenceThresholds,
  }

  return database.transaction().execute(async (transaction) => {
    const snapshot = await transaction.insertInto("metric_snapshots").values({
      tenant_id: input.tenantId,
      metric_key: input.targetType === "product_demand"
        ? "monthly_product_demand"
        : "monthly_net_revenue",
      entity_type: input.targetType === "product_demand" ? "product" : "tenant",
      entity_id: input.product?.id ?? null,
      calculation_version: ANALYTICS_CALCULATION_VERSION,
      source_from: trainingFrom,
      source_to: trainingTo,
      source_ids: sql`${JSON.stringify(
        input.buckets.map((bucket) => bucket.bucketStart),
      )}::jsonb`,
      configuration,
      inputs: sql`${JSON.stringify(input.buckets)}::jsonb`,
      result: { eligibleValues: values },
      completeness: {
        bucketCount: input.buckets.length,
        eligibleBucketCount: eligible.length,
        availabilityScore,
      },
      published,
    }).returning("id").executeTakeFirstOrThrow()
    if (published) {
      let update = transaction.updateTable("forecast_runs").set({ published: false })
        .where("tenant_id", "=", input.tenantId)
        .where("target_type", "=", input.targetType)
        .where("published", "=", true)
      update = input.product
        ? update.where("product_id", "=", input.product.id)
        : update.where("product_id", "is", null)
      await update.execute()
    }
    const run = await transaction.insertInto("forecast_runs").values({
      tenant_id: input.tenantId,
      target_type: input.targetType,
      product_id: input.product?.id ?? null,
      method,
      calculation_version: ANALYTICS_CALCULATION_VERSION,
      configuration,
      training_from: trainingFrom,
      training_to: trainingTo,
      bucket_count: input.buckets.length,
      eligible_bucket_count: eligible.length,
      data_quality: {
        exclusions: limitations,
        availabilityScore,
      },
      model_metrics: fit
        ? {
            intercept: fit.intercept,
            slope: fit.slope,
            trendReliability,
            dampedSlope: fit.slope * trendReliability,
            ...fit.metrics,
            backtest: backtest?.model ?? null,
            backtestByHorizon: backtest?.byHorizon.map((item) => ({
              horizon: item.horizon,
              ...item.model,
            })) ?? [],
          }
        : {},
      baseline_metrics: backtest
        ? {
            ...backtest.baseline,
            byHorizon: backtest.byHorizon.map((item) => ({
              horizon: item.horizon,
              ...item.baseline,
            })),
          }
        : {},
      confidence_score: confidence?.score ?? null,
      confidence_label: confidence?.label ?? "unavailable",
      status: effectiveStatus,
      limitations: sql`${JSON.stringify([
        ...limitations,
        ...(backtest && backtestOrigins < 3
          ? [{ reason: "insufficient_backtest_origins", available: backtestOrigins, required: 3 }]
          : []),
        ...(seasonal.reason ? [{ reason: seasonal.reason }] : []),
      ])}::jsonb`,
      source_snapshot_ids: sql`${JSON.stringify([snapshot.id])}::jsonb`,
      created_by: input.actorId,
      published,
    }).returning("id").executeTakeFirstOrThrow()

    if (fit && published) {
      const lastValue = values.at(-1) ?? 0
      const pointRows = Array.from(
        { length: input.settings.forecastHorizon },
        (_, index) => {
          const horizon = index + 1
          const bucketStart = monthAfter(lastBucket, horizon)
          const factor = seasonal.enabled
            ? seasonal.factors[
              new Date(`${bucketStart}T00:00:00Z`).getUTCMonth()
            ] ?? 1
            : 1
          const calculated = method === "damped_trend"
              ? forecastDampedTrend(
                  fit,
                  values.length,
                  horizon,
                  lastValue,
                  trendReliability,
                )
              : forecastOls(fit, values.length, values.length + index, factor)
          return {
            tenant_id: input.tenantId,
            forecast_run_id: run.id,
            bucket_start: bucketStart,
            horizon,
            point_estimate: calculated.point,
            lower_limit: calculated.lower,
            upper_limit: calculated.upper,
            seasonal_factor: seasonal.enabled ? factor : null,
            operational_value: roundedOperational(
              calculated.point,
              input.product?.quantityScale ?? null,
            ),
          }
        },
      )
      await transaction.insertInto("forecast_points").values(pointRows).execute()
      if (backtest) {
        await transaction.insertInto("forecast_backtests").values(
          backtest.points.map((point) => ({
            tenant_id: input.tenantId,
            forecast_run_id: run.id,
            origin_bucket: eligible[point.origin]?.bucketStart ?? lastBucket,
            horizon: point.horizon,
            actual: point.actual,
            predicted: point.predicted,
            naive_predicted: point.naivePredicted,
            residual: point.residual,
          })),
        ).execute()
      }
    }
    return { runId: run.id, published }
  })
}

export async function generateForecasts(
  database: Kysely<Database>,
  input: {
    tenantId: string
    actorId: string
    productId?: string
    includeRevenue: boolean
    includeProducts?: boolean
  },
): Promise<{ count: number; publishedCount: number; runIds: string[] }> {
  const settings = await analyticsSettings(database, input.tenantId)
  const baseProductsQuery = database.selectFrom("products as product")
    .innerJoin("units as unit", (join) => join
      .onRef("unit.id", "=", "product.unit_id")
      .onRef("unit.tenant_id", "=", "product.tenant_id"))
    .select(["product.id", "product.name", "unit.quantity_scale"])
    .where("product.tenant_id", "=", input.tenantId)
    .where("product.active", "=", true)
    .where("product.archived_at", "is", null)
    .where("product.type", "<>", "service")
  const products = input.includeProducts === false
    ? []
    : input.productId
      ? await baseProductsQuery.where("product.id", "=", input.productId)
        .orderBy("product.id").execute()
      : await baseProductsQuery
        .innerJoin("sale_items as candidate_item", (join) => join
          .onRef("candidate_item.product_id", "=", "product.id")
          .onRef("candidate_item.tenant_id", "=", "product.tenant_id"))
        .innerJoin("sales as candidate_sale", (join) => join
          .onRef("candidate_sale.id", "=", "candidate_item.sale_id")
          .onRef("candidate_sale.tenant_id", "=", "candidate_item.tenant_id"))
        .where("candidate_sale.status", "<>", "cancelled")
        .groupBy(["product.id", "product.name", "unit.quantity_scale"])
        .orderBy(sql`SUM(candidate_item.quantity - candidate_item.returned_quantity)`, "desc")
        .orderBy("product.id")
        .limit(PRODUCT_FORECAST_LIMIT)
        .execute()
  if (input.productId && products.length === 0) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found.")
  }
  const stored: StoredForecast[] = []
  for (const product of products) {
    stored.push(await persistForecast(database, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      targetType: "product_demand",
      product: {
        id: product.id,
        name: product.name,
        quantityScale: product.quantity_scale,
      },
      settings,
      buckets: await productBuckets(
        database,
        input.tenantId,
        product.id,
        settings,
      ),
    }))
  }
  if (input.includeRevenue) {
    stored.push(await persistForecast(database, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      targetType: "monthly_revenue",
      product: null,
      settings,
      buckets: await revenueBuckets(database, input.tenantId, settings),
    }))
  }
  return {
    count: stored.length,
    publishedCount: stored.filter((item) => item.published).length,
    runIds: stored.map((item) => item.runId),
  }
}
