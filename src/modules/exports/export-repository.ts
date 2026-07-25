import type { Kysely } from "kysely"
import type { Database, ExportSource } from "../../database/types.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { CreateExportInput, ExportArtifact, ExportJob } from "./types.js"

interface ExportJobRow {
  id: string
  status: ExportJob["status"]
  requested_by: string
  parameters: unknown
  processed_count: number
  total_count: number | null
  attempts: number
  error_class: string | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
  filename: string | null
  expires_at: Date | null
}

export interface ExportRepository {
  create(
    user: AuthenticatedUser,
    input: CreateExportInput,
    key: string,
    hash: string,
  ): Promise<ExportJob>
  get(tenantId: string, id: string): Promise<ExportJob | null>
  getArtifact(tenantId: string, id: string): Promise<ExportArtifact | null>
}

function exportSource(parameters: unknown): ExportSource {
  if (
    typeof parameters === "object"
    && parameters !== null
    && "source" in parameters
    && (
      parameters.source === "sales_history"
      || parameters.source === "sales_kpis"
      || parameters.source === "audit_events"
    )
  ) {
    return parameters.source
  }
  throw new Error("Stored export source is invalid")
}

function mapJob(row: ExportJobRow): ExportJob {
  return {
    id: row.id,
    source: exportSource(row.parameters),
    status: row.status,
    requestedBy: row.requested_by,
    processedCount: row.processed_count,
    totalCount: row.total_count,
    attempts: row.attempts,
    errorCode: row.error_class,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    downloadReady: row.status === "completed"
      && row.filename !== null
      && row.expires_at !== null
      && row.expires_at > new Date(),
    filename: row.filename,
    expiresAt: row.expires_at?.toISOString() ?? null,
  }
}

export class KyselyExportRepository implements ExportRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async create(
    user: AuthenticatedUser,
    input: CreateExportInput,
    key: string,
    hash: string,
  ): Promise<ExportJob> {
    const route = "POST /api/v1/exports"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("job_runs").values({
        tenant_id: user.tenantId,
        job_type: "export",
        status: "pending",
        requested_by: user.id,
        parameters: input,
        cursor: null,
        total_count: null,
        error_class: null,
        error_message: null,
        started_at: null,
        finished_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "export.requested",
        entityType: "job_run",
        entityId: row.id,
        after: { source: input.source },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 202)
      return row.id
    })
    const job = await this.get(user.tenantId, id)
    if (!job) throw new Error("Created export job could not be reloaded")
    return job
  }

  async get(tenantId: string, id: string): Promise<ExportJob | null> {
    const row = await this.database.selectFrom("job_runs as job")
      .leftJoin("export_artifacts as artifact", (join) => join
        .onRef("artifact.job_run_id", "=", "job.id")
        .onRef("artifact.tenant_id", "=", "job.tenant_id"))
      .select([
        "job.id",
        "job.status",
        "job.requested_by",
        "job.parameters",
        "job.processed_count",
        "job.total_count",
        "job.attempts",
        "job.error_class",
        "job.created_at",
        "job.started_at",
        "job.finished_at",
        "artifact.filename",
        "artifact.expires_at",
      ])
      .where("job.tenant_id", "=", tenantId)
      .where("job.id", "=", id)
      .where("job.job_type", "=", "export")
      .executeTakeFirst() as ExportJobRow | undefined
    return row ? mapJob(row) : null
  }

  async getArtifact(tenantId: string, id: string): Promise<ExportArtifact | null> {
    const row = await this.database.selectFrom("export_artifacts as artifact")
      .innerJoin("job_runs as job", "job.id", "artifact.job_run_id")
      .select([
        "artifact.filename",
        "artifact.content_type",
        "artifact.content",
        "artifact.sha256",
      ])
      .where("artifact.tenant_id", "=", tenantId)
      .where("job.id", "=", id)
      .where("job.status", "=", "completed")
      .where("artifact.expires_at", ">", new Date())
      .executeTakeFirst()
    return row
      ? {
          filename: row.filename,
          contentType: row.content_type,
          content: row.content,
          sha256: row.sha256,
        }
      : null
  }
}
