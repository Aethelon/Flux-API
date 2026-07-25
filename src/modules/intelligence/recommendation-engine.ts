import { sql, type Kysely } from "kysely"
import type {
  ConfidenceLabel,
  Database,
  RecommendationType,
} from "../../database/types.js"
import {
  ANALYTICS_CALCULATION_VERSION,
  promotion,
  replenishment,
} from "./math.js"
import { analyticsSettings } from "./settings.js"

interface ProductRow {
  id: string
  name: string
  current_price_cents: number
  current_cost_cents: number | null
  cost_source: "manual" | "receipt" | "moving_average" | "estimated" | null
  history_price_cents: number | null
  price_effective_at: Date | null
  history_cost_cents: number | null
  cost_effective_at: Date | null
  quantity_scale: number
  on_hand: string
  reserved: string
  supplier_id: string | null
  lead_time_days: number | null
  minimum_order_quantity: string | null
  pack_multiple: string | null
}

interface DailyRow {
  local_date: string
  opening: string
  closing: string
  sold: string
  returned: string
  observed_minutes: string
  in_stock_minutes: string
  stockout_minutes: string
  complete: boolean
}

interface ProposedRecommendation {
  type: RecommendationType
  productId: string
  evidence: Record<string, unknown>
  proposed: Record<string, unknown>
  confidenceScore: number | null
  confidenceLabel: ConfidenceLabel
  snapshotId: string
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {}
}

async function products(
  database: Kysely<Database>,
  tenantId: string,
): Promise<ProductRow[]> {
  return database.selectFrom("products as product")
    .innerJoin("units as unit", (join) => join
      .onRef("unit.id", "=", "product.unit_id")
      .onRef("unit.tenant_id", "=", "product.tenant_id"))
    .innerJoin("inventory_balances as balance", (join) => join
      .onRef("balance.product_id", "=", "product.id")
      .onRef("balance.tenant_id", "=", "product.tenant_id"))
    .leftJoin("product_suppliers as relation", (join) => join
      .onRef("relation.product_id", "=", "product.id")
      .onRef("relation.tenant_id", "=", "product.tenant_id")
      .on("relation.active", "=", true)
      .on("relation.valid_until", "is", null))
    .select([
      "product.id",
      "product.name",
      "product.current_price_cents",
      "product.current_cost_cents",
      "product.cost_source",
      sql<number | null>`(
        SELECT history.new_price_cents
        FROM product_price_history AS history
        WHERE history.tenant_id = product.tenant_id
          AND history.product_id = product.id
        ORDER BY history.effective_at DESC, history.id DESC
        LIMIT 1
      )`.as("history_price_cents"),
      sql<Date | null>`(
        SELECT history.effective_at
        FROM product_price_history AS history
        WHERE history.tenant_id = product.tenant_id
          AND history.product_id = product.id
        ORDER BY history.effective_at DESC, history.id DESC
        LIMIT 1
      )`.as("price_effective_at"),
      sql<number | null>`(
        SELECT history.new_cost_cents
        FROM product_cost_history AS history
        WHERE history.tenant_id = product.tenant_id
          AND history.product_id = product.id
        ORDER BY history.effective_at DESC, history.id DESC
        LIMIT 1
      )`.as("history_cost_cents"),
      sql<Date | null>`(
        SELECT history.effective_at
        FROM product_cost_history AS history
        WHERE history.tenant_id = product.tenant_id
          AND history.product_id = product.id
        ORDER BY history.effective_at DESC, history.id DESC
        LIMIT 1
      )`.as("cost_effective_at"),
      "unit.quantity_scale",
      "balance.on_hand",
      "balance.reserved",
      "relation.supplier_id",
      "relation.lead_time_days",
      "relation.minimum_order_quantity",
      "relation.pack_multiple",
    ])
    .where("product.tenant_id", "=", tenantId)
    .where("product.active", "=", true)
    .where("product.archived_at", "is", null)
    .where("product.type", "<>", "service")
    .distinctOn("product.id")
    .orderBy("product.id")
    .orderBy("relation.created_at")
    .execute()
}

async function dailyObservations(
  database: Kysely<Database>,
  tenantId: string,
  productId: string,
  windowDays: number,
): Promise<DailyRow[]> {
  return database.selectFrom("inventory_daily_snapshots")
    .select([
      sql<string>`to_char(local_date, 'YYYY-MM-DD')`.as("local_date"),
      "opening",
      "closing",
      "sold",
      "returned",
      "observed_minutes",
      "in_stock_minutes",
      "stockout_minutes",
      "complete",
    ])
    .where("tenant_id", "=", tenantId)
    .where("product_id", "=", productId)
    .where("local_date", ">=", sql<string>`CURRENT_DATE - ${windowDays}::integer`)
    .orderBy("local_date")
    .execute()
}

async function observedLeadTimes(
  database: Kysely<Database>,
  tenantId: string,
  productId: string,
  supplierId: string,
): Promise<number[]> {
  const rows = await sql<{ lead_days: string }>`
    SELECT EXTRACT(EPOCH FROM (
      receipt.received_at - purchase_order.ordered_at
    ))::numeric / 86400 AS lead_days
    FROM goods_receipt_items AS receipt_item
    INNER JOIN goods_receipts AS receipt
      ON receipt.id = receipt_item.goods_receipt_id
      AND receipt.tenant_id = receipt_item.tenant_id
    INNER JOIN purchase_orders AS purchase_order
      ON purchase_order.id = receipt.purchase_order_id
      AND purchase_order.tenant_id = receipt.tenant_id
    WHERE receipt_item.tenant_id = ${tenantId}::uuid
      AND receipt_item.product_id = ${productId}::uuid
      AND purchase_order.supplier_id = ${supplierId}::uuid
      AND purchase_order.ordered_at IS NOT NULL
      AND receipt.status = 'completed'
      AND receipt.received_at >= purchase_order.ordered_at
    ORDER BY receipt.received_at DESC
    LIMIT 20
  `.execute(database)
  return rows.rows.map((row) => Number(row.lead_days))
}

async function onOrder(
  database: Kysely<Database>,
  tenantId: string,
  productId: string,
): Promise<number> {
  const row = await database.selectFrom("purchase_order_items as item")
    .innerJoin("purchase_orders as purchase_order", (join) => join
      .onRef("purchase_order.id", "=", "item.purchase_order_id")
      .onRef("purchase_order.tenant_id", "=", "item.tenant_id"))
    .select((expression) => expression.fn.coalesce(
      expression.fn.sum<string>(
        sql`item.ordered_quantity - item.received_quantity`,
      ),
      sql<string>`0`,
    ).as("quantity"))
    .where("item.tenant_id", "=", tenantId)
    .where("item.product_id", "=", productId)
    .where("purchase_order.status", "in", ["submitted", "partially_received"])
    .executeTakeFirstOrThrow()
  return Number(row.quantity)
}

async function latestForecast(
  database: Kysely<Database>,
  tenantId: string,
  productId: string,
): Promise<{
  score: number | null
  label: ConfidenceLabel
  slope: number | null
  snapshotIds: string[]
} | null> {
  const row = await database.selectFrom("forecast_runs").select([
    "confidence_score",
    "confidence_label",
    "model_metrics",
    "source_snapshot_ids",
  ]).where("tenant_id", "=", tenantId)
    .where("product_id", "=", productId)
    .where("target_type", "=", "product_demand")
    .where("published", "=", true).executeTakeFirst()
  if (!row) return null
  const metrics = jsonRecord(row.model_metrics)
  return {
    score: row.confidence_score === null ? null : Number(row.confidence_score),
    label: row.confidence_label,
    slope: typeof metrics.slope === "number" ? metrics.slope : null,
    snapshotIds: Array.isArray(row.source_snapshot_ids)
      ? row.source_snapshot_ids.filter((value): value is string => typeof value === "string")
      : [],
  }
}

export async function generateRecommendations(
  database: Kysely<Database>,
  input: { tenantId: string; actorId: string },
): Promise<{ runId: string; count: number }> {
  const settings = await analyticsSettings(database, input.tenantId)
  const candidates: ProposedRecommendation[] = []
  for (const product of await products(database, input.tenantId)) {
    const rows = await dailyObservations(
      database,
      input.tenantId,
      product.id,
      settings.demandWindowDays,
    )
    const eligible = rows.filter((row) => {
      const observed = Number(row.observed_minutes)
      return row.complete
        && observed > 0
        && (Number(row.stockout_minutes) / observed) <= settings.stockoutExclusionRate
    })
    if (eligible.length < 2) continue
    const firstEligible = eligible[0]
    const lastEligible = eligible.at(-1)
    if (!firstEligible || !lastEligible) continue
    const dailyDemand = eligible.map((row) =>
      Number(row.sold) - Number(row.returned)
    )
    const coveredDayFractions = eligible.map((row) =>
      Math.min(1, Number(row.observed_minutes) / 1_440)
    )
    const totalCoveredDays = coveredDayFractions.reduce(
      (total, value) => total + value,
      0,
    )
    const averageOnHand = eligible.reduce((total, row, index) =>
      total + (
        ((Number(row.opening) + Number(row.closing)) / 2)
        * (coveredDayFractions[index] ?? 0)
      ), 0
    ) / totalCoveredDays
    const unitTurnover = averageOnHand <= 0
      ? null
      : dailyDemand.reduce((total, value) => total + value, 0) / averageOnHand
    const stockoutAffected = rows.some((row) => Number(row.stockout_minutes) > 0)
    const pricingReproducible = product.history_price_cents === product.current_price_cents
      && product.price_effective_at !== null
      && product.history_cost_cents === product.current_cost_cents
      && product.cost_effective_at !== null
    const forecast = await latestForecast(database, input.tenantId, product.id)
    const relationConfigured = product.supplier_id !== null
      && product.lead_time_days !== null
      && product.minimum_order_quantity !== null
      && product.pack_multiple !== null
    const replenishmentResult = relationConfigured
      ? replenishment({
          dailyDemand,
          onHand: Number(product.on_hand),
          reserved: Number(product.reserved),
          onOrder: await onOrder(database, input.tenantId, product.id),
          configuredLeadTimeDays: product.lead_time_days ?? 0,
          observedLeadTimeDays: await observedLeadTimes(
            database,
            input.tenantId,
            product.id,
            product.supplier_id ?? "",
          ),
          reviewPeriodDays: settings.reviewPeriodDays,
          serviceLevel: settings.serviceLevel,
          quantityScale: product.quantity_scale,
          packMultiple: Number(product.pack_multiple),
          minimumOrderQuantity: Number(product.minimum_order_quantity),
        })
      : null
    const sourceFrom = new Date(`${firstEligible.local_date}T00:00:00Z`)
    const sourceTo = new Date(`${lastEligible.local_date}T00:00:00Z`)
    sourceTo.setUTCDate(sourceTo.getUTCDate() + 1)
    const evidence = {
      calculationVersion: ANALYTICS_CALCULATION_VERSION,
      dataWindow: {
        from: sourceFrom.toISOString(),
        to: sourceTo.toISOString(),
      },
      completeness: {
        complete: eligible.length === rows.length,
        eligibleObservationRate: eligible.length / rows.length,
      },
      limitations: [
        "historical_daily_inventory_cost_unavailable",
        ...(forecast ? [] : ["published_demand_forecast_unavailable"]),
        ...(replenishmentResult?.leadTimeSource === "configured"
          ? ["configured_lead_time_assumption"]
          : []),
        ...(stockoutAffected ? ["stockout_affected_period"] : []),
        ...(pricingReproducible ? [] : ["price_or_cost_history_unavailable"]),
      ],
      pricingInputs: {
        sellingPriceCents: product.current_price_cents,
        unitCostCents: product.current_cost_cents,
        costSource: product.cost_source,
        priceEffectiveAt: product.price_effective_at?.toISOString() ?? null,
        costEffectiveAt: product.cost_effective_at?.toISOString() ?? null,
        reproducible: pricingReproducible,
      },
      dailyObservationCount: rows.length,
      eligibleDailyObservationCount: eligible.length,
      dailyDemand,
      coveredDayFractions,
      totalCoveredDays,
      unitTurnover,
      costTurnover: null,
      costTurnoverLimitation: "historical_daily_inventory_cost_unavailable",
      stockoutAffected,
      trendSlope: forecast?.slope ?? null,
      replenishment: replenishmentResult,
    }
    const snapshot = await database.insertInto("metric_snapshots").values({
      tenant_id: input.tenantId,
      metric_key: "inventory_recommendation_evidence",
      entity_type: "product",
      entity_id: product.id,
      calculation_version: ANALYTICS_CALCULATION_VERSION,
      source_from: sourceFrom,
      source_to: sourceTo,
      source_ids: sql`${JSON.stringify(
        rows.map((row) => row.local_date),
      )}::jsonb`,
      configuration: {
        serviceLevel: settings.serviceLevel,
        reviewPeriodDays: settings.reviewPeriodDays,
        stockoutExclusionRate: settings.stockoutExclusionRate,
      },
      inputs: { rows },
      result: evidence,
      completeness: {
        complete: eligible.length === rows.length,
        eligibleObservationRate: eligible.length / rows.length,
      },
      published: true,
    }).returning("id").executeTakeFirstOrThrow()

    if (replenishmentResult && replenishmentResult.finalSuggestion > 0) {
      candidates.push({
        type: "replenishment",
        productId: product.id,
        evidence,
        proposed: {
          supplierId: product.supplier_id,
          quantity: replenishmentResult.finalSuggestion,
          rounding: {
            raw: replenishmentResult.rawSuggestion,
            scale: replenishmentResult.scaleRoundedSuggestion,
            pack: replenishmentResult.packRoundedSuggestion,
            minimumOrder: replenishmentResult.finalSuggestion,
          },
        },
        confidenceScore: forecast?.score ?? null,
        confidenceLabel: forecast?.label ?? "unavailable",
        snapshotId: snapshot.id,
      })
    }
    if (
      replenishmentResult
      && replenishmentResult.inventoryPosition > 0
      && unitTurnover !== null
      && unitTurnover <= settings.promotionTurnoverThreshold
      && (forecast?.slope ?? 0) <= 0
      && !stockoutAffected
    ) {
      const promotionResult = promotion({
        inventoryPosition: replenishmentResult.inventoryPosition,
        orderUpToTarget: replenishmentResult.orderUpToTarget,
        sellingPriceCents: product.current_price_cents,
        unitCostCents: pricingReproducible ? product.current_cost_cents : null,
        minimumGrossMargin: settings.minimumGrossMargin,
        promotionCap: settings.promotionCap,
        coefficient: settings.promotionCoefficient,
      })
      if (promotionResult.overstockRatio >= settings.promotionOverstockThreshold) {
        candidates.push({
          type: promotionResult.suggestedDiscountRate === null
            ? "overstock_review"
            : "promotion",
          productId: product.id,
          evidence: { ...evidence, promotion: promotionResult },
          proposed: promotionResult.suggestedDiscountRate === null
            ? {
                action: "manual_review",
                reason: product.current_cost_cents === null
                  ? "unknown_cost"
                  : "price_or_cost_history_unavailable",
              }
            : {
                discountRate: promotionResult.suggestedDiscountRate,
                suggestedPriceCents: promotionResult.suggestedPriceCents,
              },
          confidenceScore: forecast?.score ?? null,
          confidenceLabel: forecast?.label ?? "unavailable",
          snapshotId: snapshot.id,
        })
      }
    }
  }

  return database.transaction().execute(async (transaction) => {
    const candidateCounts = {
      total: candidates.length,
      replenishment: candidates.filter((item) => item.type === "replenishment").length,
      promotion: candidates.filter((item) => item.type === "promotion").length,
      overstockReview: candidates.filter((item) => item.type === "overstock_review").length,
    }
    const run = await transaction.insertInto("recommendation_runs").values({
      tenant_id: input.tenantId,
      calculation_version: ANALYTICS_CALCULATION_VERSION,
      configuration: settings,
      source_snapshot_ids: sql`${JSON.stringify(
        [...new Set(candidates.map((item) => item.snapshotId))],
      )}::jsonb`,
      status: candidates.length === 0 ? "insufficient_data" : "completed",
      counts: { candidates: candidateCounts, persisted: 0 },
      created_by: input.actorId,
    }).returning("id").executeTakeFirstOrThrow()
    let persisted = 0
    for (const candidate of candidates) {
      const existing = await transaction.selectFrom("recommendations").select("id")
        .where("tenant_id", "=", input.tenantId)
        .where("product_id", "=", candidate.productId)
        .where("recommendation_type", "=", candidate.type)
        .where("state", "=", "pending").executeTakeFirst()
      if (existing) continue
      await transaction.insertInto("recommendations").values({
        tenant_id: input.tenantId,
        recommendation_run_id: run.id,
        recommendation_type: candidate.type,
        product_id: candidate.productId,
        evidence_metrics: candidate.evidence,
        proposed_value: candidate.proposed,
        confidence_score: candidate.confidenceScore,
        confidence_label: candidate.confidenceLabel,
        state: "pending",
        reviewer_id: null,
        reviewed_at: null,
        review_reason: null,
      }).execute()
      persisted += 1
    }
    await transaction.updateTable("recommendation_runs").set({
      counts: { candidates: candidateCounts, persisted },
    }).where("id", "=", run.id).execute()
    return { runId: run.id, count: persisted }
  })
}
