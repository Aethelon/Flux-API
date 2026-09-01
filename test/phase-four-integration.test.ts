import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { processPendingAi } from "../src/modules/ai/ai-job.js"
import type {
  AiProvider,
  AiProviderResult,
  SanitizedAiInput,
} from "../src/modules/ai/types.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_PHASE_FOUR_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl

class SuccessfulProvider implements AiProvider {
  readonly name = "gemini" as const
  readonly modelId = "gemini-3.5-flash-lite"
  calls = 0

  generate(input: SanitizedAiInput): Promise<AiProviderResult> {
    this.calls += 1
    const metricId = input.metrics[0]?.id
    if (!metricId) throw new Error("Expected a deterministic metric")
    return Promise.resolve({
      output: {
        summary: {
          text: "Os dados determinísticos foram consolidados.",
          sourceMetricIds: [metricId],
        },
        strengths: [{
          text: "A base publicada possui cobertura completa.",
          sourceMetricIds: [metricId],
        }],
        risks: [{
          severity: "low",
          text: "A análise deve permanecer sujeita à revisão humana.",
          sourceMetricIds: [metricId],
        }],
        recommendations: [{
          text: "Revisar os indicadores antes de qualquer decisão.",
          sourceMetricIds: [metricId],
          requiresHumanReview: true,
        }],
      },
      providerRequestId: `request-${String(this.calls)}`,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 20,
      retryCount: 0,
    })
  }
}

class InvalidProvider implements AiProvider {
  readonly name = "gemini" as const
  readonly modelId = "gemini-3.5-flash-lite"

  generate(input: SanitizedAiInput): Promise<AiProviderResult> {
    const metricId = input.metrics[0]?.id
    if (!metricId) throw new Error("Expected a deterministic metric")
    return Promise.resolve({
      output: {
        summary: {
          text: "Hallucinated confidential result 999999.",
          sourceMetricIds: [metricId],
        },
        strengths: [],
        risks: [],
        recommendations: [],
      },
      providerRequestId: "invalid-request",
      inputTokens: 20,
      outputTokens: 10,
      latencyMs: 10,
      retryCount: 0,
    })
  }
}

interface JsonResponse {
  statusCode: number
  body: Record<string, unknown>
}

void describe("Phase 4 PostgreSQL integration", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let adminToken: string
  let employeeToken: string
  let tenantId: string
  const provider = new SuccessfulProvider()
  const config = {
    ...testConfig,
    databaseUrl: integrationDatabaseUrl,
    databasePoolMax: 4,
    aiProvider: "gemini" as const,
    geminiApiKey: "integration-key",
  }

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
    app = buildApp({ config, logger: false })
    await app.ready()
    const tenant = await app.db.insertInto("tenants").values({
      slug: `phase-four-${randomUUID()}`,
      name: "Phase Four Validation",
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
    const passwordHash = await hashPassword("phase-four-password")
    const admin = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Four Admin",
      email: `admin-${randomUUID()}@phase-four.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    const employee = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Four Employee",
      email: `employee-${randomUUID()}@phase-four.test`,
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
          password: "phase-four-password",
        },
      })
      assert.equal(login.statusCode, 200)
      loginInput.assign(login.json<{ accessToken: string }>().accessToken)
    }
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
      inputs: { privateRawInput: "must-not-be-sent" },
      result: { revenueCents: 10_000, coverage: 1 },
      completeness: { coverage: 1 },
      published: true,
    }).execute()
  })

  after(async () => {
    await app.close()
  })

  void it("persists, regenerates, reviews and isolates AI insights", async () => {
    const employeeRequest = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      employeeToken,
      { period: "monthly" },
      randomUUID(),
    )
    assert.equal(employeeRequest.statusCode, 403)

    const key = randomUUID()
    const created = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      adminToken,
      { period: "monthly" },
      key,
    )
    const replayed = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      adminToken,
      { period: "monthly" },
      key,
    )
    assert.equal(created.statusCode, 202, JSON.stringify(created.body))
    assert.equal(replayed.statusCode, 202)
    assert.equal(replayed.body.id, created.body.id)
    assert.equal(await processPendingAi(app.db, config, 2, provider), 1)
    assert.equal(provider.calls, 1)

    const listed = await request(
      "GET",
      "/api/v1/intelligence/insights",
      adminToken,
    )
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.body.availability, "available")
    assert.equal(listed.body.latestRunStatus, "completed")
    const insights = listed.body.data as Array<Record<string, unknown>>
    assert.equal(insights.length, 4)
    const recommendation = insights.find((item) => item.type === "recommendation")
    assert.ok(recommendation)

    const reviewed = await request(
      "POST",
      `/api/v1/intelligence/insights/${String(recommendation.id)}/review`,
      adminToken,
      { decision: "accepted", reason: "Evidence checked by administrator" },
      randomUUID(),
    )
    assert.equal(reviewed.statusCode, 200)
    assert.equal(reviewed.body.state, "accepted")

    const second = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      adminToken,
      { period: "monthly" },
      randomUUID(),
    )
    assert.equal(second.statusCode, 202)
    assert.equal(await processPendingAi(app.db, config, 2, provider), 1)
    assert.equal(provider.calls, 2)
    const regeneratedRun = await app.db.selectFrom("ai_runs").select([
      "status",
      "cache_source_run_id",
    ]).where("job_run_id", "=", String(second.body.id))
      .executeTakeFirstOrThrow()
    assert.equal(regeneratedRun.status, "completed")
    assert.equal(regeneratedRun.cache_source_run_id, null)

    const persisted = await app.db.selectFrom("ai_runs").select([
      "sanitized_input",
      "structured_output",
      "provider_request_id",
      "input_tokens",
      "output_tokens",
    ]).where("tenant_id", "=", tenantId)
      .where("job_run_id", "=", String(created.body.id))
      .where("status", "=", "completed").executeTakeFirstOrThrow()
    const serializedInput = JSON.stringify(persisted.sanitized_input)
    assert.equal(serializedInput.includes("privateRawInput"), false)
    assert.equal(serializedInput.includes("Phase Four Admin"), false)
    assert.ok(persisted.structured_output)
    assert.equal(persisted.provider_request_id, "request-1")
    assert.equal(persisted.input_tokens, 100)
    assert.equal(persisted.output_tokens, 50)

    const job = await request(
      "GET",
      `/api/v1/jobs/${String(created.body.id)}`,
      adminToken,
    )
    assert.equal(job.statusCode, 200)
    assert.equal(job.body.runType, "insights")
    assert.equal(job.body.status, "completed")

    await app.db.insertInto("metric_snapshots").values({
      tenant_id: tenantId,
      metric_key: "inventory_summary",
      entity_type: "tenant",
      entity_id: null,
      calculation_version: "analytics-v1",
      source_from: new Date("2026-07-01T00:00:00.000Z"),
      source_to: new Date("2026-07-25T13:00:00.000Z"),
      source_ids: {},
      configuration: {},
      inputs: {},
      result: { stockCoverage: 1 },
      completeness: { coverage: 1 },
      published: true,
    }).execute()
    const invalid = await request(
      "POST",
      "/api/v1/intelligence/insights/runs",
      adminToken,
      { period: "monthly" },
      randomUUID(),
    )
    assert.equal(invalid.statusCode, 202)
    assert.equal(
      await processPendingAi(app.db, config, 2, new InvalidProvider()),
      1,
    )
    const rejected = await app.db.selectFrom("ai_runs").select([
      "status",
      "structured_output",
      "rejection_reasons",
    ]).where("job_run_id", "=", String(invalid.body.id))
      .executeTakeFirstOrThrow()
    assert.equal(rejected.status, "rejected")
    assert.equal(rejected.structured_output, null)
    const diagnostic = JSON.stringify(rejected.rejection_reasons)
    assert.ok(diagnostic.includes("output_digest:"))
    assert.equal(diagnostic.includes("confidential"), false)

    const afterRejection = await request(
      "GET",
      "/api/v1/intelligence/insights",
      adminToken,
    )
    assert.equal(afterRejection.body.availability, "available")
    assert.equal(afterRejection.body.latestRunStatus, "rejected")
  })
})
