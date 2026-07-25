import { sql, type Kysely } from "kysely"
import type { AppConfig } from "../../config/env.js"
import type {
  AiProviderName,
  AiRunStatus,
  Database,
} from "../../database/types.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { currentCorrelationId } from "../../shared/observability/request-context.js"
import type {
  AiInsight,
  AiJob,
  SanitizedAiInput,
} from "./types.js"

export interface AiCursor {
  createdAt: string
  id: string
}

export interface AiRepository {
  createRun(
    user: AuthenticatedUser,
    input: SanitizedAiInput,
    inputHash: string,
    sourceSnapshotIds: string[],
    provider: AiProviderName,
    modelId: string,
    config: AppConfig,
    route: string,
    key: string,
    requestHash: string,
  ): Promise<AiJob>
  getJob(tenantId: string, id: string): Promise<AiJob | null>
  listInsights(
    tenantId: string,
    input: { limit: number; cursor?: AiCursor; state?: AiInsight["state"] },
  ): Promise<{
    data: AiInsight[]
    hasMore: boolean
    latestRunStatus: AiRunStatus | null
  }>
  review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    key: string,
    hash: string,
  ): Promise<AiInsight | null>
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function job(row: {
  id: string
  status: AiJob["status"]
  processed_count: number
  total_count: number | null
  attempts: number
  error_class: string | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}): AiJob {
  return {
    id: row.id,
    runType: "insights",
    status: row.status,
    processedCount: row.processed_count,
    totalCount: row.total_count,
    attempts: row.attempts,
    errorCode: row.error_class,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  }
}

function insight(row: {
  id: string
  ai_run_id: string
  status: AiRunStatus
  provider: AiProviderName
  model_id: string
  prompt_version: string
  schema_version: string
  policy_version: string
  insight_type: AiInsight["type"]
  text: string
  severity: AiInsight["severity"]
  source_metric_ids: unknown
  requires_human_review: boolean
  state: AiInsight["state"]
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: Date | null
  review_reason: string | null
  created_at: Date
}): AiInsight {
  return {
    id: row.id,
    runId: row.ai_run_id,
    runStatus: row.status,
    provider: row.provider,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    policyVersion: row.policy_version,
    type: row.insight_type,
    text: row.text,
    severity: row.severity,
    sourceMetricIds: stringArray(row.source_metric_ids),
    requiresHumanReview: row.requires_human_review,
    state: row.state,
    reviewer: row.reviewer_id && row.reviewer_name
      ? { id: row.reviewer_id, name: row.reviewer_name }
      : null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewReason: row.review_reason,
    createdAt: row.created_at.toISOString(),
  }
}

export class KyselyAiRepository implements AiRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async createRun(
    user: AuthenticatedUser,
    input: SanitizedAiInput,
    inputHash: string,
    sourceSnapshotIds: string[],
    provider: AiProviderName,
    modelId: string,
    config: AppConfig,
    route: string,
    key: string,
    requestHash: string,
  ): Promise<AiJob> {
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(
        transaction,
        user,
        route,
        key,
        requestHash,
      )
      if (replay) return replay
      const jobRow = await transaction.insertInto("job_runs").values({
        tenant_id: user.tenantId,
        job_type: "ai",
        status: "pending",
        requested_by: user.id,
        parameters: { runType: "insights" },
        cursor: null,
        total_count: null,
        error_class: null,
        error_message: null,
        started_at: null,
        finished_at: null,
        correlation_id: currentCorrelationId(),
      }).returning("id").executeTakeFirstOrThrow()
      const run = await transaction.insertInto("ai_runs").values({
        tenant_id: user.tenantId,
        job_run_id: jobRow.id,
        provider,
        model_id: modelId,
        prompt_version: config.aiPromptVersion,
        schema_version: config.aiSchemaVersion,
        policy_version: config.aiPolicyVersion,
        input_hash: inputHash,
        source_snapshot_ids: sql`${JSON.stringify(sourceSnapshotIds)}::jsonb`,
        sanitized_input: input,
        structured_output: null,
        status: "pending",
        validation_outcome: "pending",
        rejection_reasons: sql`'[]'::jsonb`,
        provider_request_id: null,
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        estimated_cost_micro_usd: null,
        cache_source_run_id: null,
        error_class: null,
        error_message: null,
        created_by: user.id,
        started_at: null,
        finished_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "ai.insights.requested",
        entityType: "ai_run",
        entityId: run.id,
        after: {
          jobId: jobRow.id,
          provider,
          modelId,
          inputHash,
          sourceSnapshotIds,
        },
      })
      await saveEntityIdempotency(
        transaction,
        user,
        route,
        key,
        requestHash,
        jobRow.id,
        202,
      )
      return jobRow.id
    })
    const created = await this.getJob(user.tenantId, id)
    if (!created) throw new Error("Created AI job could not be reloaded")
    return created
  }

  async getJob(tenantId: string, id: string): Promise<AiJob | null> {
    const row = await this.database.selectFrom("job_runs").select([
      "id",
      "status",
      "processed_count",
      "total_count",
      "attempts",
      "error_class",
      "created_at",
      "started_at",
      "finished_at",
    ]).where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("job_type", "=", "ai").executeTakeFirst()
    return row ? job(row) : null
  }

  async listInsights(
    tenantId: string,
    input: { limit: number; cursor?: AiCursor; state?: AiInsight["state"] },
  ): Promise<{
    data: AiInsight[]
    hasMore: boolean
    latestRunStatus: AiRunStatus | null
  }> {
    let query = this.database.selectFrom("ai_insights as insight")
      .innerJoin("ai_runs as run", (join) => join
        .onRef("run.id", "=", "insight.ai_run_id")
        .onRef("run.tenant_id", "=", "insight.tenant_id"))
      .leftJoin("users as reviewer", (join) => join
        .onRef("reviewer.id", "=", "insight.reviewer_id")
        .onRef("reviewer.tenant_id", "=", "insight.tenant_id"))
      .select([
        "insight.id",
        "insight.ai_run_id",
        "run.status",
        "run.provider",
        "run.model_id",
        "run.prompt_version",
        "run.schema_version",
        "run.policy_version",
        "insight.insight_type",
        "insight.text",
        "insight.severity",
        "insight.source_metric_ids",
        "insight.requires_human_review",
        "insight.state",
        "insight.reviewer_id",
        "reviewer.name as reviewer_name",
        "insight.reviewed_at",
        "insight.review_reason",
        "insight.created_at",
      ]).where("insight.tenant_id", "=", tenantId)
    if (input.state) query = query.where("insight.state", "=", input.state)
    if (input.cursor) {
      query = query.where(sql<boolean>`
        (insight.created_at, insight.id)
        < (${new Date(input.cursor.createdAt)}, ${input.cursor.id}::uuid)
      `)
    }
    const [rows, latest] = await Promise.all([
      query.orderBy("insight.created_at", "desc").orderBy("insight.id", "desc")
        .limit(input.limit + 1).execute(),
      this.database.selectFrom("ai_runs").select("status")
        .where("tenant_id", "=", tenantId)
        .orderBy("created_at", "desc").orderBy("id", "desc")
        .executeTakeFirst(),
    ])
    return {
      data: rows.slice(0, input.limit).map(insight),
      hasMore: rows.length > input.limit,
      latestRunStatus: latest?.status ?? null,
    }
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    key: string,
    hash: string,
  ): Promise<AiInsight | null> {
    const entityId = await this.database.transaction().execute(
      async (transaction) => {
        const route = "POST /api/v1/intelligence/insights/:id/review"
        const replay = await replayedEntityId(transaction, user, route, key, hash)
        if (replay) return replay
        const current = await transaction.selectFrom("ai_insights")
          .select(["id", "state"])
          .where("tenant_id", "=", user.tenantId)
          .where("id", "=", id)
          .where("requires_human_review", "=", true)
          .forUpdate().executeTakeFirst()
        if (!current || current.state !== "pending") return null
        await transaction.updateTable("ai_insights").set({
          state: input.decision,
          reviewer_id: user.id,
          reviewed_at: new Date(),
          review_reason: input.reason,
        }).where("tenant_id", "=", user.tenantId)
          .where("id", "=", id).execute()
        await recordDomainEvent(transaction, user, {
          action: `ai.insight.${input.decision}`,
          entityType: "ai_insight",
          entityId: id,
          reason: input.reason,
          before: { state: "pending" },
          after: { state: input.decision },
        })
        await saveEntityIdempotency(
          transaction,
          user,
          route,
          key,
          hash,
          id,
          200,
        )
        return id
      },
    )
    if (!entityId) return null
    const result = await this.listInsights(user.tenantId, { limit: 1 })
    if (result.data[0]?.id === entityId) return result.data[0]
    const row = await this.database.selectFrom("ai_insights as insight")
      .innerJoin("ai_runs as run", (join) => join
        .onRef("run.id", "=", "insight.ai_run_id")
        .onRef("run.tenant_id", "=", "insight.tenant_id"))
      .leftJoin("users as reviewer", (join) => join
        .onRef("reviewer.id", "=", "insight.reviewer_id")
        .onRef("reviewer.tenant_id", "=", "insight.tenant_id"))
      .select([
        "insight.id",
        "insight.ai_run_id",
        "run.status",
        "run.provider",
        "run.model_id",
        "run.prompt_version",
        "run.schema_version",
        "run.policy_version",
        "insight.insight_type",
        "insight.text",
        "insight.severity",
        "insight.source_metric_ids",
        "insight.requires_human_review",
        "insight.state",
        "insight.reviewer_id",
        "reviewer.name as reviewer_name",
        "insight.reviewed_at",
        "insight.review_reason",
        "insight.created_at",
      ]).where("insight.tenant_id", "=", user.tenantId)
      .where("insight.id", "=", entityId).executeTakeFirst()
    return row ? insight(row) : null
  }
}
