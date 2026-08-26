import { createHash } from "node:crypto"
import { sql, type Kysely } from "kysely"
import type { Database, UserRole } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import { KyselyAuditRepository } from "../audit/audit-repository.js"
import { KyselyHistoryRepository } from "../history/history-repository.js"
import type { SaleHistoryFilters } from "../history/types.js"
import { createCsv } from "./csv.js"
import { createSalesHistoryCsv } from "./sales-history-csv.js"
import type {
  AuditEventsExportInput,
  CreateExportInput,
  SalesHistoryExportInput,
} from "./types.js"

const MAX_EXPORT_ROWS = 10_000
const EXPORT_TTL_MS = 24 * 60 * 60 * 1_000

interface ClaimedJob {
  id: string
  tenant_id: string
  requested_by: string
  parameters: unknown
  correlation_id: string | null
}

interface Requester {
  id: string
  role: UserRole
  status: "active" | "inactive"
  archived_at: Date | null
  permissions: string[]
}

interface GeneratedExport {
  filename: string
  content: string
  rowCount: number
}

function exportInput(value: unknown): CreateExportInput {
  if (typeof value !== "object" || value === null || !("source" in value)) {
    throw new AppError(400, "INVALID_EXPORT_PARAMETERS", "Stored export parameters are invalid.")
  }
  if (
    value.source !== "sales_history"
    && value.source !== "sales_kpis"
    && value.source !== "audit_events"
  ) {
    throw new AppError(400, "INVALID_EXPORT_PARAMETERS", "Stored export source is invalid.")
  }
  return value as CreateExportInput
}

function assertRequester(requester: Requester): void {
  if (requester.status !== "active" || requester.archived_at !== null) {
    throw new AppError(403, "EXPORT_REQUESTER_INACTIVE", "Export requester is inactive.")
  }
  const allowed = requester.role === "admin"
  if (!allowed) {
    throw new AppError(403, "FORBIDDEN", "Export permission is no longer available.")
  }
}

function salesFilters(input: SalesHistoryExportInput): SaleHistoryFilters {
  return {
    limit: MAX_EXPORT_ROWS,
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    ...(input.search ? { search: input.search } : {}),
  }
}

async function generateSalesHistory(
  database: Kysely<Database>,
  job: ClaimedJob,
  requester: Requester,
  input: SalesHistoryExportInput,
): Promise<GeneratedExport> {
  const result = await new KyselyHistoryRepository(database).listSales(
    job.tenant_id,
    salesFilters(input),
    requester.role === "admin",
  )
  if (result.hasMore) {
    throw new AppError(
      409,
      "EXPORT_ROW_LIMIT_EXCEEDED",
      `Export exceeds the ${String(MAX_EXPORT_ROWS)} row limit.`,
    )
  }
  const settings = await database.selectFrom("tenant_settings")
    .select(["timezone", "currency"])
    .where("tenant_id", "=", job.tenant_id)
    .executeTakeFirstOrThrow()
  return {
    filename: `sales-history-${job.id}.csv`,
    content: createSalesHistoryCsv(result.data, {
      currency: settings.currency,
      timeZone: settings.timezone,
    }),
    rowCount: result.data.length,
  }
}

async function generateSalesKpis(
  database: Kysely<Database>,
  job: ClaimedJob,
  input: Extract<CreateExportInput, { source: "sales_kpis" }>,
): Promise<GeneratedExport> {
  const kpis = await new KyselyHistoryRepository(database).getKpis(job.tenant_id, {
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
  })
  const headers = [
    "calculation_version",
    "from",
    "to",
    "timezone",
    "currency",
    "data_freshness_at",
    "gross_revenue_cents",
    "discount_amount_cents",
    "returned_amount_cents",
    "net_revenue_cents",
    "completed_sale_count",
    "average_ticket_cents",
    "units_sold",
    "cogs_cents",
    "gross_profit_cents",
    "gross_margin_rate",
    "costs_complete",
    "cost_coverage_rate",
  ]
  const rows = [[
    kpis.calculationVersion,
    kpis.dateRange.from,
    kpis.dateRange.to,
    kpis.timezone,
    kpis.currency,
    kpis.dataFreshnessAt,
    kpis.grossRevenueCents,
    kpis.discountAmountCents,
    kpis.returnedAmountCents,
    kpis.netRevenueCents,
    kpis.completedSaleCount,
    kpis.averageTicketCents,
    kpis.unitsSold,
    kpis.cogsCents,
    kpis.grossProfitCents,
    kpis.grossMarginRate,
    kpis.completeness.costsComplete,
    kpis.completeness.costCoverageRate,
  ]]
  return {
    filename: `sales-kpis-${job.id}.csv`,
    content: createCsv(headers, rows),
    rowCount: 1,
  }
}

async function generateAuditEvents(
  database: Kysely<Database>,
  job: ClaimedJob,
  input: AuditEventsExportInput,
): Promise<GeneratedExport> {
  const result = await new KyselyAuditRepository(database).list(job.tenant_id, {
    limit: MAX_EXPORT_ROWS,
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.auditSource ? { source: input.auditSource } : {}),
  })
  if (result.hasMore) {
    throw new AppError(
      409,
      "EXPORT_ROW_LIMIT_EXCEEDED",
      `Export exceeds the ${String(MAX_EXPORT_ROWS)} row limit.`,
    )
  }
  const headers = [
    "event_id",
    "occurred_at",
    "actor_type",
    "actor_id",
    "actor_name",
    "action",
    "entity_type",
    "entity_id",
    "source",
    "reason",
    "request_id",
    "correlation_id",
    "before_json",
    "after_json",
  ]
  const rows = result.data.map((event) => [
    event.id,
    event.occurredAt,
    event.actor.type,
    event.actor.id,
    event.actor.name,
    event.action,
    event.entityType,
    event.entityId,
    event.source,
    event.reason,
    event.requestId,
    event.correlationId,
    JSON.stringify(event.before),
    JSON.stringify(event.after),
  ])
  return {
    filename: `audit-events-${job.id}.csv`,
    content: createCsv(headers, rows),
    rowCount: rows.length,
  }
}

async function generate(
  database: Kysely<Database>,
  job: ClaimedJob,
): Promise<GeneratedExport> {
  const input = exportInput(job.parameters)
  const requester = await database.selectFrom("users as user").select([
    "user.id", "user.role", "user.status", "user.archived_at",
    sql<string[]>`COALESCE((SELECT json_agg(permission_key) FROM job_role_permissions WHERE job_role_id = "user".job_role_id), '[]'::json)`.as("permissions"),
  ]).where("user.tenant_id", "=", job.tenant_id)
    .where("id", "=", job.requested_by).executeTakeFirst()
  if (!requester) {
    throw new AppError(403, "EXPORT_REQUESTER_NOT_FOUND", "Export requester was not found.")
  }
  assertRequester(requester)
  switch (input.source) {
    case "sales_history":
      return generateSalesHistory(database, job, requester, input)
    case "sales_kpis":
      return generateSalesKpis(database, job, input)
    case "audit_events":
      return generateAuditEvents(database, job, input)
  }
}

async function claim(database: Kysely<Database>): Promise<ClaimedJob | null> {
  return database.transaction().execute(async (transaction) => {
    const row = await transaction.selectFrom("job_runs")
      .select(["id", "tenant_id", "requested_by", "parameters", "correlation_id"])
      .where("job_type", "=", "export")
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
          expression("started_at", "<", new Date(Date.now() - (5 * 60 * 1_000))),
        ]),
      ]))
      .orderBy("available_at")
      .orderBy("created_at")
      .orderBy("id")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst()
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

async function complete(
  database: Kysely<Database>,
  job: ClaimedJob,
  generated: GeneratedExport,
): Promise<void> {
  const now = new Date()
  await database.transaction().execute(async (transaction) => {
    await transaction.insertInto("export_artifacts").values({
      tenant_id: job.tenant_id,
      job_run_id: job.id,
      filename: generated.filename,
      content_type: "text/csv; charset=utf-8",
      content: generated.content,
      row_count: generated.rowCount,
      sha256: createHash("sha256").update(generated.content).digest("hex"),
      expires_at: new Date(now.getTime() + EXPORT_TTL_MS),
    }).onConflict((conflict) => conflict.column("job_run_id").doUpdateSet({
      filename: generated.filename,
      content: generated.content,
      row_count: generated.rowCount,
      sha256: createHash("sha256").update(generated.content).digest("hex"),
      created_at: now,
      expires_at: new Date(now.getTime() + EXPORT_TTL_MS),
    })).execute()
    await transaction.updateTable("job_runs").set({
      status: "completed",
      total_count: generated.rowCount,
      processed_count: generated.rowCount,
      finished_at: now,
      updated_at: now,
    }).where("id", "=", job.id).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenant_id,
      actor_type: "job",
      actor_id: job.id,
      action: "export.completed",
      entity_type: "job_run",
      entity_id: job.id,
      request_id: job.correlation_id,
      correlation_id: job.correlation_id,
      source: "worker",
      reason: null,
      before_json: null,
      after_json: { rowCount: generated.rowCount },
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
  const errorCode = error instanceof AppError ? error.code : "EXPORT_GENERATION_FAILED"
  const safeMessage = error instanceof AppError
    ? error.message
    : "Export generation failed."
  await database.transaction().execute(async (transaction) => {
    const current = await transaction.selectFrom("job_runs").select("attempts")
      .where("id", "=", job.id).executeTakeFirstOrThrow()
    await transaction.updateTable("job_runs").set({
      status: "failed",
      error_class: errorCode,
      error_message: safeMessage,
      available_at: new Date(now.getTime() + (Math.min(current.attempts, 3) * 5_000)),
      finished_at: now,
      updated_at: now,
    }).where("id", "=", job.id).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenant_id,
      actor_type: "job",
      actor_id: job.id,
      action: "export.failed",
      entity_type: "job_run",
      entity_id: job.id,
      request_id: job.correlation_id,
      correlation_id: job.correlation_id,
      source: "worker",
      reason: errorCode,
      before_json: null,
      after_json: null,
      ip_address: null,
      user_agent: null,
    }).execute()
  })
}

export async function processPendingExports(
  database: Kysely<Database>,
  maxJobs = 5,
): Promise<number> {
  let processed = 0
  while (processed < maxJobs) {
    const job = await claim(database)
    if (!job) break
    try {
      await complete(database, job, await generate(database, job))
    } catch (error) {
      await fail(database, job, error)
    }
    processed += 1
  }
  return processed
}

export async function cleanupExpiredExports(
  database: Kysely<Database>,
): Promise<number> {
  const result = await database.deleteFrom("export_artifacts")
    .where("expires_at", "<=", new Date()).executeTakeFirst()
  return Number(result.numDeletedRows)
}
