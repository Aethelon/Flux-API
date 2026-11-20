import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { sql } from "kysely"
import { buildApp } from "../src/app.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { processPendingAnalytics } from "../src/modules/intelligence/analytics-job.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_PHASE_THREE_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl

interface JsonResponse {
  statusCode: number
  body: Record<string, unknown>
}

void describe("Phase 3 PostgreSQL integration", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let adminToken: string
  let employeeToken: string
  let tenantId: string
  let adminId: string
  let demandProductId: string
  let foreignForecastId: string
  let foreignRecommendationId: string

  async function request(
    method: "GET" | "POST",
    url: string,
    token: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<JsonResponse> {
    const response = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    })
    return {
      statusCode: response.statusCode,
      body: response.json<Record<string, unknown>>(),
    }
  }

  before(async () => {
    app = buildApp({
      config: {
        ...testConfig,
        databaseUrl: integrationDatabaseUrl,
        databasePoolMax: 4,
      },
      logger: false,
    })
    await app.ready()

    const tenant = await app.db.insertInto("tenants").values({
      slug: `phase-three-${randomUUID()}`,
      name: "Phase Three Validation",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    tenantId = tenant.id
    const timezone = "America/Recife"
    await app.db.insertInto("tenant_settings").values({
      tenant_id: tenantId,
      timezone,
      currency: "BRL",
      forecast_horizon: 3,
      forecast_minimum_buckets: 3,
      forecast_preferred_buckets: 6,
      demand_window_days: 365,
      review_period_days: 7,
    }).execute()

    const passwordHash = await hashPassword("phase-three-password")
    const admin = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Three Admin",
      email: `admin-${randomUUID()}@phase-three.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    adminId = admin.id
    const employee = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Three Employee",
      email: `employee-${randomUUID()}@phase-three.test`,
      phone: null,
      password_hash: passwordHash,
      role: "funcionario",
      status: "active",
      archived_at: null,
    }).returning("email").executeTakeFirstOrThrow()

    for (const loginInput of [
      { email: admin.email, assign: (token: string) => { adminToken = token } },
      { email: employee.email, assign: (token: string) => { employeeToken = token } },
    ]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: loginInput.email,
          password: "phase-three-password",
        },
      })
      assert.equal(login.statusCode, 200)
      loginInput.assign(login.json<{ accessToken: string }>().accessToken)
    }

    const category = await app.db.insertInto("categories").values({
      tenant_id: tenantId,
      parent_id: null,
      name: "Phase Three Category",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const unit = await app.db.insertInto("units").values({
      tenant_id: tenantId,
      name: "Unidade",
      abbreviation: `u-${randomUUID().slice(0, 6)}`,
      allows_fractional: false,
      quantity_scale: 0,
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const products = await app.db.insertInto("products").values([
      {
        tenant_id: tenantId,
        category_id: category.id,
        unit_id: unit.id,
        sku: null,
        barcode: null,
        type: "finished_product",
        name: "Demand Product",
        description: "",
        active: true,
        minimum_stock: 2,
        current_price_cents: 1_000,
        current_cost_cents: 500,
        cost_source: "manual",
        created_by: adminId,
        updated_by: adminId,
        archived_at: null,
      },
      {
        tenant_id: tenantId,
        category_id: category.id,
        unit_id: unit.id,
        sku: null,
        barcode: null,
        type: "finished_product",
        name: "Overstock Product",
        description: "",
        active: true,
        minimum_stock: 0,
        current_price_cents: 2_000,
        current_cost_cents: 800,
        cost_source: "manual",
        created_by: adminId,
        updated_by: adminId,
        archived_at: null,
      },
    ]).returning(["id", "name"]).execute()
    const demandProduct = products.find((product) => product.name === "Demand Product")
    const overstockProduct = products.find((product) => product.name === "Overstock Product")
    assert.ok(demandProduct)
    assert.ok(overstockProduct)
    demandProductId = demandProduct.id
    await app.db.insertInto("product_price_history").values(products.map((product) => ({
      tenant_id: tenantId,
      product_id: product.id,
      old_price_cents: null,
      new_price_cents: product.name === "Demand Product" ? 1_000 : 2_000,
      actor_id: adminId,
      reason: "Phase Three fixture",
      effective_at: new Date("2026-01-01T00:00:00.000Z"),
    }))).execute()
    await app.db.insertInto("product_cost_history").values(products.map((product) => ({
      tenant_id: tenantId,
      product_id: product.id,
      old_cost_cents: null,
      new_cost_cents: product.name === "Demand Product" ? 500 : 800,
      source: "manual",
      actor_id: adminId,
      reason: "Phase Three fixture",
      effective_at: new Date("2026-01-01T00:00:00.000Z"),
    }))).execute()
    await app.db.insertInto("inventory_balances").values([
      {
        tenant_id: tenantId,
        product_id: demandProduct.id,
        on_hand: 0,
        reserved: 0,
        average_unit_cost_cents: 500,
      },
      {
        tenant_id: tenantId,
        product_id: overstockProduct.id,
        on_hand: 100,
        reserved: 0,
        average_unit_cost_cents: 800,
      },
    ]).execute()

    const register = await app.db.insertInto("cash_registers").values({
      tenant_id: tenantId,
      code: `phase-three-${randomUUID().slice(0, 6)}`,
      name: "Phase Three Register",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    // Align the six completed months with the forecast's PostgreSQL calendar.
    const { monthStart } = await app.db.selectNoFrom(
      sql<string>`to_char(now() AT TIME ZONE ${timezone}, 'YYYY-MM-01')`.as("monthStart"),
    ).executeTakeFirstOrThrow()
    const anchor = new Date(`${monthStart}T00:00:00Z`)
    function relativeMonthDate(monthOffset: number, day: number, hour: number): Date {
      return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthOffset, day, hour))
    }

    const cashSession = await app.db.insertInto("cash_sessions").values({
      tenant_id: tenantId,
      cash_register_id: register.id,
      opening_operator_id: adminId,
      opened_at: relativeMonthDate(-6, 1, 9),
      opening_amount_cents: 0,
      status: "closed",
      closing_operator_id: adminId,
      closed_at: relativeMonthDate(0, 1, 0),
      closing_note: "Phase Three fixture",
    }).returning("id").executeTakeFirstOrThrow()

    const monthlyDemand = [2, 3, 4, 5, 6, 7]
    for (const [index, quantity] of monthlyDemand.entries()) {
      const completedAt = relativeMonthDate(index - monthlyDemand.length, 15, 14)
      const businessDate = completedAt.toISOString().slice(0, 10)
      const sale = await app.db.insertInto("sales").values({
        tenant_id: tenantId,
        business_number: index + 1,
        status: "completed",
        customer_id: null,
        customer_name_snapshot: null,
        operator_id: adminId,
        cash_session_id: cashSession.id,
        gross_amount_cents: quantity * 1_000,
        discount_amount_cents: 0,
        net_amount_cents: quantity * 1_000,
        returned_amount_cents: 0,
        change_amount_cents: 0,
        business_date: businessDate,
        completed_at: completedAt,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_reason: null,
      }).returning("id").executeTakeFirstOrThrow()
      await app.db.insertInto("sale_items").values({
        tenant_id: tenantId,
        sale_id: sale.id,
        product_id: demandProduct.id,
        product_name_snapshot: demandProduct.name,
        product_type_snapshot: "finished_product",
        unit_abbreviation_snapshot: "u",
        quantity,
        unit_price_cents: 1_000,
        gross_amount_cents: quantity * 1_000,
        allocated_discount_cents: 0,
        net_amount_cents: quantity * 1_000,
        unit_cost_snapshot_cents: 500,
        returned_quantity: 0,
        returned_net_amount_cents: 0,
        service_order_id: null,
        service_order_previous_column_id: null,
      }).execute()
      await app.db.insertInto("inventory_daily_snapshots").values({
        tenant_id: tenantId,
        product_id: demandProduct.id,
        local_date: businessDate,
        opening: 20,
        received: 0,
        sold: quantity,
        returned: 0,
        adjusted: 0,
        closing: 20 - quantity,
        reserved: 0,
        in_stock_minutes: 1_440,
        stockout_minutes: 0,
        observed_minutes: 1_440,
        last_observed_at: completedAt,
        complete: true,
      }).execute()
    }

    for (const day of ["20", "21", "22"]) {
      const observedAt = relativeMonthDate(-1, Number(day), 23)
      await app.db.insertInto("inventory_daily_snapshots").values({
        tenant_id: tenantId,
        product_id: overstockProduct.id,
        local_date: observedAt.toISOString().slice(0, 10),
        opening: 100,
        received: 0,
        sold: 0,
        returned: 0,
        adjusted: 0,
        closing: 100,
        reserved: 0,
        in_stock_minutes: 1_440,
        stockout_minutes: 0,
        observed_minutes: 1_440,
        last_observed_at: observedAt,
        complete: true,
      }).execute()
    }

    const foreignTenant = await app.db.insertInto("tenants").values({
      slug: `phase-three-foreign-${randomUUID()}`,
      name: "Foreign Phase Three Tenant",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("tenant_settings").values({
      tenant_id: foreignTenant.id,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    const foreignAdmin = await app.db.insertInto("users").values({
      tenant_id: foreignTenant.id,
      name: "Foreign Admin",
      email: `admin-${randomUUID()}@foreign-phase-three.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignCategory = await app.db.insertInto("categories").values({
      tenant_id: foreignTenant.id,
      parent_id: null,
      name: "Foreign Category",
      active: true,
      created_by: foreignAdmin.id,
      updated_by: foreignAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignUnit = await app.db.insertInto("units").values({
      tenant_id: foreignTenant.id,
      name: "Foreign Unit",
      abbreviation: `fu-${randomUUID().slice(0, 6)}`,
      allows_fractional: false,
      quantity_scale: 0,
      active: true,
      created_by: foreignAdmin.id,
      updated_by: foreignAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignProduct = await app.db.insertInto("products").values({
      tenant_id: foreignTenant.id,
      category_id: foreignCategory.id,
      unit_id: foreignUnit.id,
      sku: null,
      barcode: null,
      type: "finished_product",
      name: "Foreign Product",
      description: "",
      active: true,
      minimum_stock: 0,
      current_price_cents: 1_000,
      current_cost_cents: 500,
      cost_source: "manual",
      created_by: foreignAdmin.id,
      updated_by: foreignAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignSnapshot = await app.db.insertInto("metric_snapshots").values({
      tenant_id: foreignTenant.id,
      metric_key: "foreign_fixture",
      entity_type: "product",
      entity_id: foreignProduct.id,
      calculation_version: "analytics-v1",
      source_from: new Date("2026-01-01T00:00:00.000Z"),
      source_to: new Date("2026-07-01T00:00:00.000Z"),
      source_ids: sql`'[]'::jsonb`,
      configuration: {},
      inputs: {},
      result: {},
      completeness: {},
      published: true,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignForecast = await app.db.insertInto("forecast_runs").values({
      tenant_id: foreignTenant.id,
      target_type: "product_demand",
      product_id: foreignProduct.id,
      method: "naive_last_value",
      calculation_version: "analytics-v1",
      configuration: {},
      training_from: new Date("2026-01-01T00:00:00.000Z"),
      training_to: new Date("2026-07-01T00:00:00.000Z"),
      bucket_count: 6,
      eligible_bucket_count: 6,
      data_quality: {},
      model_metrics: {},
      baseline_metrics: {},
      confidence_score: 50,
      confidence_label: "medium",
      status: "completed",
      limitations: sql`'[]'::jsonb`,
      source_snapshot_ids: sql`${JSON.stringify([foreignSnapshot.id])}::jsonb`,
      created_by: foreignAdmin.id,
      published: true,
    }).returning("id").executeTakeFirstOrThrow()
    foreignForecastId = foreignForecast.id
    const foreignRun = await app.db.insertInto("recommendation_runs").values({
      tenant_id: foreignTenant.id,
      calculation_version: "analytics-v1",
      configuration: {},
      source_snapshot_ids: sql`${JSON.stringify([foreignSnapshot.id])}::jsonb`,
      status: "completed",
      counts: { candidates: { total: 1 }, persisted: 1 },
      created_by: foreignAdmin.id,
    }).returning("id").executeTakeFirstOrThrow()
    const foreignRecommendation = await app.db.insertInto("recommendations").values({
      tenant_id: foreignTenant.id,
      recommendation_run_id: foreignRun.id,
      recommendation_type: "overstock_review",
      product_id: foreignProduct.id,
      evidence_metrics: {},
      proposed_value: { quantity: 1 },
      confidence_score: null,
      confidence_label: "unavailable",
      state: "pending",
      reviewer_id: null,
      reviewed_at: null,
      review_reason: null,
    }).returning("id").executeTakeFirstOrThrow()
    foreignRecommendationId = foreignRecommendation.id
  })

  after(async () => {
    await app.close()
  })

  void it("persists forecasts, evidence, backtests, and admin-only access", async () => {
    assert.equal(
      (await request("GET", "/api/v1/intelligence/forecasts", employeeToken)).statusCode,
      403,
    )
    const key = randomUUID()
    const created = await request(
      "POST",
      "/api/v1/intelligence/forecasts/runs",
      adminToken,
      {},
      key,
    )
    const replayed = await request(
      "POST",
      "/api/v1/intelligence/forecasts/runs",
      adminToken,
      {},
      key,
    )
    assert.equal(created.statusCode, 202)
    assert.equal(replayed.statusCode, 202)
    assert.equal(replayed.body.id, created.body.id)

    assert.equal(await processPendingAnalytics(app.db, 10), 1)
    const job = await request(
      "GET",
      `/api/v1/jobs/${String(created.body.id)}`,
      adminToken,
    )
    assert.equal(job.statusCode, 200)
    assert.equal(job.body.status, "completed")
    assert.equal(job.body.totalCount, 2)
    assert.equal(
      (await request(
        "GET",
        `/api/v1/jobs/${String(created.body.id)}`,
        employeeToken,
      )).statusCode,
      403,
    )

    const published = await request(
      "GET",
      "/api/v1/intelligence/forecasts",
      adminToken,
    )
    assert.equal(published.statusCode, 200)
    const forecasts = published.body.data as Array<Record<string, unknown>>
    assert.equal(forecasts.length, 2)
    assert.equal(forecasts.some((forecast) => forecast.id === foreignForecastId), false)
    const demand = forecasts.find((forecast) => forecast.targetType === "product_demand")
    const revenue = forecasts.find((forecast) => forecast.targetType === "monthly_revenue")
    assert.ok(demand)
    assert.ok(revenue)
    assert.equal(demand.calculationVersion, "analytics-v1")
    assert.equal(demand.method, "ols_trend")
    assert.deepEqual(
      (demand.points as Array<Record<string, unknown>>)
        .map((point) => point.operationalValue),
      [8, 9, 10],
    )
    assert.deepEqual(
      (revenue.points as Array<Record<string, unknown>>)
        .map((point) => point.operationalValue),
      [8_000, 9_000, 10_000],
    )
    assert.equal(
      ((demand.modelMetrics as Record<string, unknown>)
        .backtestByHorizon as unknown[]).length,
      3,
    )

    const allRuns = await request(
      "GET",
      "/api/v1/intelligence/forecasts?publishedOnly=false",
      adminToken,
    )
    assert.equal(allRuns.statusCode, 200)
    const persistedRuns = allRuns.body.data as Array<Record<string, unknown>>
    assert.equal(persistedRuns.length, 2)
    assert.equal(
      persistedRuns.some((run) => run.status === "poor_data_quality"),
      false,
    )
    const snapshotCount = await app.db.selectFrom("metric_snapshots")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()
    const backtestCount = await app.db.selectFrom("forecast_backtests")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId).executeTakeFirstOrThrow()
    assert.equal(Number(snapshotCount.count), 2)
    assert.ok(Number(backtestCount.count) > 0)
  })

  void it("applies recommendations only after an administrator decision", async () => {
    assert.equal(
      (await request(
        "POST",
        "/api/v1/intelligence/recommendations/runs",
        employeeToken,
        undefined,
        randomUUID(),
      )).statusCode,
      403,
    )
    const created = await request(
      "POST",
      "/api/v1/intelligence/recommendations/runs",
      adminToken,
      undefined,
      randomUUID(),
    )
    assert.equal(created.statusCode, 202)
    assert.equal(await processPendingAnalytics(app.db, 10), 1)

    const listed = await request(
      "GET",
      "/api/v1/intelligence/recommendations",
      adminToken,
    )
    assert.equal(listed.statusCode, 200)
    const recommendations = listed.body.data as Array<Record<string, unknown>>
    assert.equal(
      recommendations.some((item) => item.id === foreignRecommendationId),
      false,
    )
    assert.ok(recommendations.some((item) => item.type === "replenishment"))
    assert.ok(recommendations.some((item) => item.type === "promotion"))

    const replenishment = recommendations.find((item) =>
      item.type === "replenishment"
      && (item.product as Record<string, unknown>).id === demandProductId
    )
    assert.ok(replenishment)
    assert.equal(replenishment.calculationVersion, "analytics-v1")
    const replenishmentValue = replenishment.proposedValue as Record<string, unknown>
    assert.ok(Number(replenishmentValue.quantity) > 0)
    const promotion = recommendations.find((item) => item.type === "promotion")
    assert.ok(promotion)
    assert.deepEqual(promotion.proposedValue, {
      discountRate: 0.3,
      suggestedPriceCents: 1_400,
    })
    const evidence = replenishment.evidenceMetrics as Record<string, unknown>
    assert.ok(evidence.dataWindow)
    assert.ok(evidence.completeness)
    assert.ok(evidence.limitations)
    const promotionProductId = String(
      (promotion.product as Record<string, unknown>).id,
    )
    const promotionProductBeforeReview = await app.db.selectFrom("products")
      .select("current_price_cents")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", promotionProductId)
      .executeTakeFirstOrThrow()
    assert.equal(promotionProductBeforeReview.current_price_cents, 2_000)

    const reviewKey = randomUUID()
    const reviewed = await request(
      "POST",
      `/api/v1/intelligence/recommendations/${String(replenishment.id)}/review`,
      adminToken,
      { decision: "accepted", reason: "Validated against current stock" },
      reviewKey,
    )
    const replayed = await request(
      "POST",
      `/api/v1/intelligence/recommendations/${String(replenishment.id)}/review`,
      adminToken,
      { decision: "accepted", reason: "Validated against current stock" },
      reviewKey,
    )
    assert.equal(reviewed.statusCode, 200)
    assert.equal(replayed.statusCode, 200)
    assert.equal(reviewed.body.state, "accepted")
    assert.equal(replayed.body.id, reviewed.body.id)
    assert.equal(reviewed.body.reviewReason, "Validated against current stock")
    const foreignReview = await request(
      "POST",
      `/api/v1/intelligence/recommendations/${foreignRecommendationId}/review`,
      adminToken,
      { decision: "rejected", reason: "Must remain tenant isolated" },
      randomUUID(),
    )
    assert.equal(foreignReview.statusCode, 409)

    const balanceAfterApplication = await app.db.selectFrom("inventory_balances")
      .select("on_hand")
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", demandProductId)
      .executeTakeFirstOrThrow()
    assert.equal(Number(balanceAfterApplication.on_hand), 0)

    const promotionReview = await request(
      "POST",
      `/api/v1/intelligence/recommendations/${String(promotion.id)}/review`,
      adminToken,
      { decision: "accepted", reason: "Approved promotional price" },
      randomUUID(),
    )
    assert.equal(promotionReview.statusCode, 200)
    assert.equal(promotionReview.body.state, "accepted")
    const promotionProductAfterReview = await app.db.selectFrom("products")
      .select("current_price_cents")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", promotionProductId)
      .executeTakeFirstOrThrow()
    assert.equal(promotionProductAfterReview.current_price_cents, 1_400)
    const priceHistory = await app.db.selectFrom("product_price_history")
      .select(["old_price_cents", "new_price_cents", "reason"])
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", promotionProductId)
      .orderBy("effective_at", "desc")
      .executeTakeFirstOrThrow()
    assert.equal(priceHistory.old_price_cents, 2_000)
    assert.equal(priceHistory.new_price_cents, 1_400)
    assert.match(priceHistory.reason, new RegExp(String(promotion.id)))

    const auditCount = await app.db.selectFrom("audit_events")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("action", "in", [
        "analytics.completed",
        "recommendation.applied",
        "recommendation.reviewed",
        "product.price_changed",
      ])
      .executeTakeFirstOrThrow()
    assert.ok(Number(auditCount.count) >= 4)
  })
})
