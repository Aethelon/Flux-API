import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import { generateForecasts } from "./forecast-engine.js"
import { generateRecommendations } from "./recommendation-engine.js"

interface ClaimedJob {
  id: string
  tenant_id: string
  requested_by: string
  parameters: unknown
  correlation_id: string | null
}

function parameters(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new AppError(400, "INVALID_ANALYTICS_JOB", "Analytics job parameters are invalid.")
  }
  return value as Record<string, unknown>
}

async function claim(database: Kysely<Database>): Promise<ClaimedJob | null> {
  return database.transaction().execute(async (transaction) => {
    const row = await transaction.selectFrom("job_runs").select([
      "id", "tenant_id", "requested_by", "parameters", "correlation_id",
    ]).where("job_type", "=", "analytics")
      .where("available_at", "<=", new Date())
      .where((expression) => expression.or([
        expression("status", "=", "pending"),
        expression.and([
          expression("status", "=", "failed"),
          expression("attempts", "<", 3),
        ]),
        expression.and([
          expression("status", "=", "processing"),
          expression("attempts", "<", 3),
          expression("started_at", "<", new Date(Date.now() - (15 * 60 * 1_000))),
        ]),
      ])).orderBy("available_at").orderBy("created_at").orderBy("id")
      .forUpdate().skipLocked().executeTakeFirst()
    if (!row) return null
    await transaction.updateTable("job_runs").set({
      status: "processing",
      attempts: sql`attempts + 1`,
      started_at: new Date(),
      finished_at: null,
      error_class: null,
      error_message: null,
      updated_at: new Date(),
    }).where("id", "=", row.id).execute()
    return row
  })
}

async function processJob(
  database: Kysely<Database>,
  job: ClaimedJob,
): Promise<{ count: number; result: unknown }> {
  const input = parameters(job.parameters)
  if (input.runType === "forecasts") {
    const result = await generateForecasts(database, {
      tenantId: job.tenant_id,
      actorId: job.requested_by,
      ...(typeof input.productId === "string" ? { productId: input.productId } : {}),
      includeRevenue: input.includeRevenue === true,
      includeProducts: input.includeProducts !== false,
    })
    return { count: result.count, result }
  }
  if (input.runType === "recommendations") {
    const result = await generateRecommendations(database, {
      tenantId: job.tenant_id,
      actorId: job.requested_by,
    })
    return { count: result.count, result }
  }
  throw new AppError(400, "INVALID_ANALYTICS_JOB", "Analytics job type is invalid.")
}

async function complete(
  database: Kysely<Database>,
  job: ClaimedJob,
  output: { count: number; result: unknown },
): Promise<void> {
  const now = new Date()
  await database.transaction().execute(async (transaction) => {
    await transaction.updateTable("job_runs").set({
      status: "completed",
      total_count: output.count,
      processed_count: output.count,
      cursor: output.result,
      finished_at: now,
      updated_at: now,
    }).where("id", "=", job.id).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenant_id,
      actor_type: "job",
      actor_id: job.id,
      action: "analytics.completed",
      entity_type: "job_run",
      entity_id: job.id,
      request_id: job.correlation_id,
      correlation_id: job.correlation_id,
      source: "worker",
      reason: null,
      before_json: null,
      after_json: { count: output.count },
      ip_address: null,
      user_agent: null,
    }).execute()
  })
}

async function fail(
  database: Kysely<Database>,
  job: ClaimedJob,
  error: unknown,
): Promise<void> {
  const now = new Date()
  const code = error instanceof AppError ? error.code : "ANALYTICS_GENERATION_FAILED"
  await database.transaction().execute(async (transaction) => {
    const current = await transaction.selectFrom("job_runs").select("attempts")
      .where("id", "=", job.id).executeTakeFirstOrThrow()
    await transaction.updateTable("job_runs").set({
      status: "failed",
      error_class: code,
      error_message: error instanceof AppError
        ? error.message : "Analytics generation failed.",
      available_at: new Date(now.getTime() + (Math.min(current.attempts, 3) * 30_000)),
      finished_at: now,
      updated_at: now,
    }).where("id", "=", job.id).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenant_id,
      actor_type: "job",
      actor_id: job.id,
      action: "analytics.failed",
      entity_type: "job_run",
      entity_id: job.id,
      request_id: job.correlation_id,
      correlation_id: job.correlation_id,
      source: "worker",
      reason: code,
      before_json: null,
      after_json: null,
      ip_address: null,
      user_agent: null,
    }).execute()
  })
}

export async function processPendingAnalytics(
  database: Kysely<Database>,
  maxJobs = 2,
): Promise<number> {
  let processed = 0
  while (processed < maxJobs) {
    const job = await claim(database)
    if (!job) break
    try {
      await complete(database, job, await processJob(database, job))
    } catch (error) {
      await fail(database, job, error)
    }
    processed += 1
  }
  return processed
}
