import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { processPendingAi } from "../src/modules/ai/ai-job.js"
import { AiProviderError } from "../src/modules/ai/providers.js"
import type {
  AiProvider,
  AiProviderResult,
  SanitizedAiInput,
} from "../src/modules/ai/types.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { processPendingAnalytics } from "../src/modules/intelligence/analytics-job.js"
import { runHousekeeping } from "../src/shared/persistence/housekeeping-job.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_PHASE_FIVE_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl

class FailingProvider implements AiProvider {
  readonly name = "gemini" as const
  readonly modelId = "gemini-3.5-flash-lite"

  generate(input: SanitizedAiInput): Promise<AiProviderResult> {
    void input
    return Promise.reject(new AiProviderError(
      "AI_PROVIDER_UNAVAILABLE",
      "The provider is unavailable for the Phase 5 failure test.",
      false,
      503,
    ))
  }
}

interface JsonResponse {
  statusCode: number
  body: Record<string, unknown>
}

void describe("Phase 5 PostgreSQL hardening integration", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let tenantId: string
  let adminId: string
  let employeeId: string
  let adminToken: string
  let employeeToken: string
  let singleStockProductId: string
  let idempotentProductId: string
  let otherTenantProductId: string
  const config = {
    ...testConfig,
    databaseUrl: integrationDatabaseUrl,
    databasePoolMax: 12,
    httpBodyLimitBytes: 16_384,
    aiProvider: "gemini" as const,
    geminiApiKey: "phase-five-provider-key",
  }

  async function request(
    method: "GET" | "POST" | "PATCH",
    url: string,
    token: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
    correlationId?: string,
  ): Promise<JsonResponse> {
    const response = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(correlationId ? { "x-request-id": correlationId } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    })
    return {
      statusCode: response.statusCode,
      body: response.json<Record<string, unknown>>(),
    }
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email,
        password: "phase-five-password",
      },
    })
    assert.equal(response.statusCode, 200, response.body)
    return response.json<{ accessToken: string }>().accessToken
  }

  before(async () => {
    app = buildApp({ config, logger: false })
    await app.ready()
    const tenant = await app.db.insertInto("tenants").values({
      slug: `phase-five-${randomUUID()}`,
      name: "Phase Five Validation",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    tenantId = tenant.id
    await app.db.insertInto("tenant_settings").values({
      tenant_id: tenantId,
      timezone: "America/Recife",
      currency: "BRL",
      ai_enabled: true,
    }).execute()
    const passwordHash = await hashPassword("phase-five-password")
    const admin = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Five Admin",
      email: `admin-${randomUUID()}@phase-five.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    adminId = admin.id
    const employee = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Five Employee",
      email: `employee-${randomUUID()}@phase-five.test`,
      phone: null,
      password_hash: passwordHash,
      role: "funcionario",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    employeeId = employee.id
    adminToken = await login(admin.email)
    employeeToken = await login(employee.email)

    const category = await app.db.insertInto("categories").values({
      tenant_id: tenantId,
      parent_id: null,
      name: "Phase Five Category",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const unit = await app.db.insertInto("units").values({
      tenant_id: tenantId,
      name: "Unit",
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
        type: "finished_product" as const,
        name: "Single Stock Product",
        description: "",
        active: true,
        minimum_stock: 0,
        current_price_cents: 1_000,
        current_cost_cents: 500,
        cost_source: "moving_average" as const,
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
        type: "finished_product" as const,
        name: "Idempotent Product",
        description: "",
        active: true,
        minimum_stock: 0,
        current_price_cents: 1_000,
        current_cost_cents: 500,
        cost_source: "moving_average" as const,
        created_by: adminId,
        updated_by: adminId,
        archived_at: null,
      },
    ]).returning(["id", "name"]).execute()
    singleStockProductId = products.find((product) =>
      product.name === "Single Stock Product"
    )?.id ?? ""
    idempotentProductId = products.find((product) =>
      product.name === "Idempotent Product"
    )?.id ?? ""
    assert.ok(singleStockProductId)
    assert.ok(idempotentProductId)
    await app.db.insertInto("inventory_balances").values([
      {
        tenant_id: tenantId,
        product_id: singleStockProductId,
        on_hand: 1,
        reserved: 0,
        average_unit_cost_cents: 500,
      },
      {
        tenant_id: tenantId,
        product_id: idempotentProductId,
        on_hand: 2,
        reserved: 0,
        average_unit_cost_cents: 500,
      },
    ]).execute()

    const register = await app.db.insertInto("cash_registers").values({
      tenant_id: tenantId,
      code: `phase-five-${randomUUID().slice(0, 6)}`,
      name: "Phase Five Register",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("cash_register_assignments").values({
      tenant_id: tenantId,
      user_id: employeeId,
      cash_register_id: register.id,
      valid_until: null,
      assigned_by: adminId,
      reason: "Phase Five concurrency validation.",
    }).execute()

    const otherTenant = await app.db.insertInto("tenants").values({
      slug: `phase-five-other-${randomUUID()}`,
      name: "Phase Five Other Tenant",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("tenant_settings").values({
      tenant_id: otherTenant.id,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    const otherAdmin = await app.db.insertInto("users").values({
      tenant_id: otherTenant.id,
      name: "Other Tenant Admin",
      email: `admin-${randomUUID()}@phase-five-other.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const otherCategory = await app.db.insertInto("categories").values({
      tenant_id: otherTenant.id,
      parent_id: null,
      name: "Other Tenant Category",
      active: true,
      created_by: otherAdmin.id,
      updated_by: otherAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const otherUnit = await app.db.insertInto("units").values({
      tenant_id: otherTenant.id,
      name: "Unit",
      abbreviation: `u-${randomUUID().slice(0, 6)}`,
      allows_fractional: false,
      quantity_scale: 0,
      active: true,
      created_by: otherAdmin.id,
      updated_by: otherAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    otherTenantProductId = (await app.db.insertInto("products").values({
      tenant_id: otherTenant.id,
      category_id: otherCategory.id,
      unit_id: otherUnit.id,
      sku: null,
      barcode: null,
      type: "finished_product",
      name: "Other Tenant Product",
      description: "",
      active: true,
      minimum_stock: 0,
      current_price_cents: 1_000,
      current_cost_cents: 500,
      cost_source: "moving_average",
      created_by: otherAdmin.id,
      updated_by: otherAdmin.id,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()).id

    await app.db.insertInto("metric_snapshots").values({
      tenant_id: tenantId,
      metric_key: "sales_summary",
      entity_type: "tenant",
      entity_id: null,
      calculation_version: "analytics-v1",
      source_from: new Date("2026-07-01T00:00:00.000Z"),
      source_to: new Date("2026-07-25T12:00:00.000Z"),
      source_ids: {},
      configuration: {},
      inputs: {},
      result: { revenueCents: 10_000, coverage: 1 },
      completeness: { coverage: 1 },
      published: true,
    }).execute()
  })

  after(async () => {
    await app.close()
  })

  void it("enforces role and tenant boundaries under load", async () => {
    for (const url of [
      "/api/v1/dashboard",
      "/api/v1/intelligence/forecasts",
      "/api/v1/cash-sessions",
      "/api/v1/employees",
      "/api/v1/history/kpis",
    ]) {
      const response = await request("GET", url, employeeToken)
      assert.equal(response.statusCode, 403, `${url}: ${JSON.stringify(response.body)}`)
    }
    assert.equal(
      (await request(
        "GET",
        `/api/v1/products/${otherTenantProductId}`,
        adminToken,
      )).statusCode,
      404,
    )
    const loadResponses = await Promise.all(Array.from({ length: 50 }, () =>
      app.inject({ method: "GET", url: "/api/v1/health/live" })
    ))
    assert.equal(loadResponses.every((response) => response.statusCode === 200), true)
  })

  void it("allows only administrators to manage tenant AI availability", async () => {
    const forbidden = await request(
      "GET",
      "/api/v1/intelligence/settings",
      employeeToken,
    )
    assert.equal(forbidden.statusCode, 403)

    const initial = await request(
      "GET",
      "/api/v1/intelligence/settings",
      adminToken,
    )
    assert.equal(initial.statusCode, 200)
    assert.deepEqual(initial.body, {
      enabled: true,
      provider: "gemini",
      providerConfigured: true,
    })

    const disabled = await request(
      "PATCH",
      "/api/v1/intelligence/settings",
      adminToken,
      { enabled: false },
      randomUUID(),
    )
    assert.equal(disabled.statusCode, 200)
    assert.equal(disabled.body.enabled, false)

    const restored = await request(
      "PATCH",
      "/api/v1/intelligence/settings",
      adminToken,
      { enabled: true },
      randomUUID(),
    )
    assert.equal(restored.statusCode, 200)
    assert.equal(restored.body.enabled, true)
  })

  void it("prevents duplicate sessions, overselling and concurrent idempotency replays", async () => {
    const opens = await Promise.all([
      request(
        "POST",
        "/api/v1/cash-registers/me/open",
        employeeToken,
        { openingAmountCents: 1_000 },
        randomUUID(),
        "phase-five-open-001",
      ),
      request(
        "POST",
        "/api/v1/cash-registers/me/open",
        employeeToken,
        { openingAmountCents: 1_000 },
        randomUUID(),
        "phase-five-open-002",
      ),
    ])
    assert.deepEqual(opens.map((result) => result.statusCode).sort(), [201, 409])
    const successfulOpenCorrelation = opens[0].statusCode === 201
      ? "phase-five-open-001" : "phase-five-open-002"
    const openAudit = await app.db.selectFrom("audit_events").select("correlation_id")
      .where("tenant_id", "=", tenantId)
      .where("action", "=", "cash_session.opened")
      .executeTakeFirstOrThrow()
    assert.equal(openAudit.correlation_id, successfulOpenCorrelation)
    const openOutbox = await app.db.selectFrom("outbox_events").select("correlation_id")
      .where("tenant_id", "=", tenantId)
      .where("event_type", "=", "cash_session.opened")
      .executeTakeFirstOrThrow()
    assert.equal(openOutbox.correlation_id, successfulOpenCorrelation)

    const salePayload = (productId: string) => ({
      items: [{ productId, quantity: 1 }],
      payments: [{ method: "pix", amountCents: 1_000 }],
    })
    const competingSales = await Promise.all([
      request(
        "POST",
        "/api/v1/sales",
        employeeToken,
        salePayload(singleStockProductId),
        randomUUID(),
      ),
      request(
        "POST",
        "/api/v1/sales",
        employeeToken,
        salePayload(singleStockProductId),
        randomUUID(),
      ),
    ])
    assert.deepEqual(
      competingSales.map((result) => result.statusCode).sort(),
      [201, 409],
    )
    const singleBalance = await app.db.selectFrom("inventory_balances")
      .select("on_hand")
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", singleStockProductId)
      .executeTakeFirstOrThrow()
    assert.equal(Number(singleBalance.on_hand), 0)

    const sharedKey = randomUUID()
    const replayedSales = await Promise.all([
      request(
        "POST",
        "/api/v1/sales",
        employeeToken,
        salePayload(idempotentProductId),
        sharedKey,
      ),
      request(
        "POST",
        "/api/v1/sales",
        employeeToken,
        salePayload(idempotentProductId),
        sharedKey,
      ),
    ])
    assert.equal(replayedSales.every((result) => result.statusCode === 201), true)
    assert.equal(replayedSales[0].body.id, replayedSales[1].body.id)
    const idempotentBalance = await app.db.selectFrom("inventory_balances")
      .select("on_hand")
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", idempotentProductId)
      .executeTakeFirstOrThrow()
    assert.equal(Number(idempotentBalance.on_hand), 1)
  })

  void it("isolates provider failure and preserves deterministic operations", async () => {
    const correlationId = "phase-five-ai-failure-001"
    const aiJob = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      adminToken,
      { period: "monthly" },
      randomUUID(),
      correlationId,
    )
    assert.equal(aiJob.statusCode, 202, JSON.stringify(aiJob.body))
    assert.equal(
      await processPendingAi(app.db, config, 1, new FailingProvider()),
      1,
    )
    const failedJob = await app.db.selectFrom("job_runs").select([
      "status",
      "error_class",
      "correlation_id",
    ]).where("id", "=", String(aiJob.body.id)).executeTakeFirstOrThrow()
    assert.equal(failedJob.status, "failed")
    assert.equal(failedJob.error_class, "AI_PROVIDER_UNAVAILABLE")
    assert.equal(failedJob.correlation_id, correlationId)

    const analytics = await request(
      "POST",
      "/api/v1/intelligence/forecasts/runs",
      adminToken,
      { productId: idempotentProductId },
      randomUUID(),
      "phase-five-analytics-001",
    )
    assert.equal(analytics.statusCode, 202, JSON.stringify(analytics.body))
    assert.equal(await processPendingAnalytics(app.db, 1), 1)
    const analyticsJob = await app.db.selectFrom("job_runs").select("status")
      .where("id", "=", String(analytics.body.id)).executeTakeFirstOrThrow()
    assert.equal(analyticsJob.status, "completed")
    assert.equal(
      (await request("GET", "/api/v1/cash-registers/me", employeeToken)).statusCode,
      200,
    )
  })

  void it("exposes protected metrics, limits request bodies and removes expired records", async () => {
    const metrics = await app.inject({
      method: "GET",
      url: "/api/v1/monitoring/metrics",
      headers: {
        authorization: `Bearer ${config.monitoringToken ?? ""}`,
      },
    })
    assert.equal(metrics.statusCode, 200, metrics.body)
    assert.match(metrics.body, /flux_http_requests_total/)
    assert.match(metrics.body, /flux_database_connections/)
    assert.match(metrics.body, /flux_alert\{type="backup"\} 1/)

    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "oversized@phase-five.test",
        password: "x".repeat(20_000),
      },
    })
    assert.equal(oversized.statusCode, 413)
    assert.equal(oversized.json<{ code: string }>().code, "PAYLOAD_TOO_LARGE")

    const expiredAt = new Date(Date.now() - (100 * 24 * 60 * 60 * 1_000))
    const expiredKey = randomUUID()
    await app.db.insertInto("idempotency_records").values({
      tenant_id: tenantId,
      user_id: adminId,
      route: "POST /phase-five-expired",
      idempotency_key: expiredKey,
      request_hash: createHash("sha256").update(expiredKey).digest("hex"),
      response_status: 200,
      response_body: {},
      expires_at: expiredAt,
    }).execute()
    const expiredOutbox = await app.db.insertInto("outbox_events").values({
      tenant_id: tenantId,
      event_type: "phase_five.expired",
      aggregate_type: "tenant",
      aggregate_id: tenantId,
      correlation_id: null,
      payload: {},
      status: "completed",
      processed_at: expiredAt,
      last_error: null,
      created_at: expiredAt,
    }).returning("id").executeTakeFirstOrThrow()
    const expiredSession = await app.db.insertInto("auth_sessions").values({
      tenant_id: tenantId,
      user_id: adminId,
      family_id: randomUUID(),
      refresh_token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
      user_agent: null,
      ip_address: null,
      expires_at: expiredAt,
      last_used_at: null,
      revoked_at: expiredAt,
      revoke_reason: "Phase Five expiration test.",
      replaced_by_session_id: null,
      created_at: expiredAt,
    }).returning("id").executeTakeFirstOrThrow()
    const result = await runHousekeeping(app.db, config)
    assert.ok(result.idempotencyRecords >= 1)
    assert.ok(result.outboxEvents >= 1)
    assert.ok(result.authSessions >= 1)
    assert.equal(
      await app.db.selectFrom("outbox_events").select("id")
        .where("id", "=", expiredOutbox.id).executeTakeFirst(),
      undefined,
    )
    assert.equal(
      await app.db.selectFrom("auth_sessions").select("id")
        .where("id", "=", expiredSession.id).executeTakeFirst(),
      undefined,
    )
  })
})
