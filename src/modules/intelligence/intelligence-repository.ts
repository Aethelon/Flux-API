import { sql, type Kysely } from "kysely"
import type {
  Database,
  ForecastTargetType,
  RecommendationType,
} from "../../database/types.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { currentCorrelationId } from "../../shared/observability/request-context.js"
import type {
  AnalyticsJob,
  ForecastRun,
  Recommendation,
} from "./types.js"

export interface IntelligenceCursor {
  createdAt: string
  id: string
}

export interface IntelligenceRepository {
  createJob(
    user: AuthenticatedUser,
    input: Record<string, unknown>,
    route: string,
    key: string,
    hash: string,
  ): Promise<AnalyticsJob>
  getJob(tenantId: string, id: string): Promise<AnalyticsJob | null>
  listForecasts(
    tenantId: string,
    input: {
      limit: number
      cursor?: IntelligenceCursor
      targetType?: ForecastTargetType
      productId?: string
      publishedOnly: boolean
    },
  ): Promise<{ data: ForecastRun[]; hasMore: boolean }>
  listRecommendations(
    tenantId: string,
    input: {
      limit: number
      cursor?: IntelligenceCursor
      type?: RecommendationType
      state?: Recommendation["state"]
      productId?: string
      id?: string
    },
  ): Promise<{ data: Recommendation[]; hasMore: boolean }>
  review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    key: string,
    hash: string,
  ): Promise<Recommendation | null>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function runType(parameters: unknown): AnalyticsJob["runType"] {
  const value = record(parameters).runType
  if (value === "forecasts" || value === "recommendations") return value
  throw new Error("Stored analytics job type is invalid")
}

export class KyselyIntelligenceRepository implements IntelligenceRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async createJob(
    user: AuthenticatedUser,
    input: Record<string, unknown>,
    route: string,
    key: string,
    hash: string,
  ): Promise<AnalyticsJob> {
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("job_runs").values({
        tenant_id: user.tenantId,
        job_type: "analytics",
        status: "pending",
        requested_by: user.id,
        parameters: input,
        cursor: null,
        total_count: null,
        error_class: null,
        error_message: null,
        started_at: null,
        finished_at: null,
        correlation_id: currentCorrelationId(),
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "analytics.requested",
        entityType: "job_run",
        entityId: row.id,
        after: { runType: input.runType },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 202)
      return row.id
    })
    const job = await this.getJob(user.tenantId, id)
    if (!job) throw new Error("Created analytics job could not be reloaded")
    return job
  }

  async getJob(tenantId: string, id: string): Promise<AnalyticsJob | null> {
    const row = await this.database.selectFrom("job_runs").select([
      "id",
      "status",
      "parameters",
      "processed_count",
      "total_count",
      "attempts",
      "error_class",
      "created_at",
      "started_at",
      "finished_at",
    ]).where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("job_type", "=", "analytics").executeTakeFirst()
    return row
      ? {
          id: row.id,
          runType: runType(row.parameters),
          status: row.status,
          processedCount: row.processed_count,
          totalCount: row.total_count,
          attempts: row.attempts,
          errorCode: row.error_class,
          createdAt: row.created_at.toISOString(),
          startedAt: row.started_at?.toISOString() ?? null,
          finishedAt: row.finished_at?.toISOString() ?? null,
        }
      : null
  }

  async listForecasts(
    tenantId: string,
    input: {
      limit: number
      cursor?: IntelligenceCursor
      targetType?: ForecastTargetType
      productId?: string
      publishedOnly: boolean
    },
  ): Promise<{ data: ForecastRun[]; hasMore: boolean }> {
    let query = this.database.selectFrom("forecast_runs as run")
      .leftJoin("products as product", (join) => join
        .onRef("product.id", "=", "run.product_id")
        .onRef("product.tenant_id", "=", "run.tenant_id"))
      .select([
        "run.id",
        "run.target_type",
        "run.product_id",
        "product.name as product_name",
        "run.method",
        "run.calculation_version",
        "run.training_from",
        "run.training_to",
        "run.bucket_count",
        "run.eligible_bucket_count",
        "run.data_quality",
        "run.model_metrics",
        "run.baseline_metrics",
        "run.confidence_score",
        "run.confidence_label",
        "run.status",
        "run.limitations",
        "run.source_snapshot_ids",
        "run.created_at",
        "run.published",
      ]).where("run.tenant_id", "=", tenantId)
    if (input.targetType) query = query.where("run.target_type", "=", input.targetType)
    if (input.productId) query = query.where("run.product_id", "=", input.productId)
    if (input.publishedOnly) query = query.where("run.published", "=", true)
    if (input.cursor) {
      query = query.where(sql<boolean>`
        (run.created_at, run.id)
        < (${new Date(input.cursor.createdAt)}, ${input.cursor.id}::uuid)
      `)
    }
    const rows = await query.orderBy("run.created_at", "desc").orderBy("run.id", "desc")
      .limit(input.limit + 1).execute()
    const selected = rows.slice(0, input.limit)
    const data = await Promise.all(selected.map(async (row) => {
      const points = await this.database.selectFrom("forecast_points").select([
        "id",
        sql<string>`to_char(bucket_start, 'YYYY-MM-DD')`.as("bucket_start"),
        "horizon",
        "point_estimate",
        "lower_limit",
        "upper_limit",
        "seasonal_factor",
        "operational_value",
      ]).where("tenant_id", "=", tenantId)
        .where("forecast_run_id", "=", row.id)
        .orderBy("horizon").execute()
      return {
        id: row.id,
        targetType: row.target_type,
        product: row.product_id && row.product_name
          ? { id: row.product_id, name: row.product_name }
          : null,
        method: row.method,
        calculationVersion: row.calculation_version,
        trainingFrom: row.training_from.toISOString(),
        trainingTo: row.training_to.toISOString(),
        bucketCount: row.bucket_count,
        eligibleBucketCount: row.eligible_bucket_count,
        dataQuality: row.data_quality,
        modelMetrics: row.model_metrics,
        baselineMetrics: row.baseline_metrics,
        confidenceScore: row.confidence_score === null
          ? null : Number(row.confidence_score),
        confidenceLabel: row.confidence_label,
        status: row.status,
        limitations: row.limitations,
        sourceSnapshotIds: stringArray(row.source_snapshot_ids),
        createdAt: row.created_at.toISOString(),
        published: row.published,
        points: points.map((point) => ({
          id: point.id,
          bucketStart: point.bucket_start,
          horizon: point.horizon,
          pointEstimate: Number(point.point_estimate),
          lowerLimit: point.lower_limit === null ? null : Number(point.lower_limit),
          upperLimit: point.upper_limit === null ? null : Number(point.upper_limit),
          seasonalFactor: point.seasonal_factor === null
            ? null : Number(point.seasonal_factor),
          operationalValue: Number(point.operational_value),
        })),
      }
    }))
    return { data, hasMore: rows.length > input.limit }
  }

  async listRecommendations(
    tenantId: string,
    input: {
      limit: number
      cursor?: IntelligenceCursor
      type?: RecommendationType
      state?: Recommendation["state"]
      productId?: string
      id?: string
    },
  ): Promise<{ data: Recommendation[]; hasMore: boolean }> {
    let query = this.database.selectFrom("recommendations as recommendation")
      .innerJoin("recommendation_runs as run", (join) => join
        .onRef("run.id", "=", "recommendation.recommendation_run_id")
        .onRef("run.tenant_id", "=", "recommendation.tenant_id"))
      .innerJoin("products as product", (join) => join
        .onRef("product.id", "=", "recommendation.product_id")
        .onRef("product.tenant_id", "=", "recommendation.tenant_id"))
      .leftJoin("users as reviewer", (join) => join
        .onRef("reviewer.id", "=", "recommendation.reviewer_id")
        .onRef("reviewer.tenant_id", "=", "recommendation.tenant_id"))
      .select([
        "recommendation.id",
        "recommendation.recommendation_run_id",
        "run.calculation_version",
        "run.configuration",
        "recommendation.recommendation_type",
        "product.id as product_id",
        "product.name as product_name",
        "recommendation.evidence_metrics",
        "recommendation.proposed_value",
        "recommendation.confidence_score",
        "recommendation.confidence_label",
        "recommendation.state",
        "reviewer.id as reviewer_id",
        "reviewer.name as reviewer_name",
        "recommendation.reviewed_at",
        "recommendation.review_reason",
        "recommendation.created_at",
      ]).where("recommendation.tenant_id", "=", tenantId)
    if (input.type) query = query.where("recommendation.recommendation_type", "=", input.type)
    if (input.state) query = query.where("recommendation.state", "=", input.state)
    if (input.productId) query = query.where("recommendation.product_id", "=", input.productId)
    if (input.id) query = query.where("recommendation.id", "=", input.id)
    if (input.cursor) {
      query = query.where(sql<boolean>`
        (recommendation.created_at, recommendation.id)
        < (${new Date(input.cursor.createdAt)}, ${input.cursor.id}::uuid)
      `)
    }
    const rows = await query.orderBy("recommendation.created_at", "desc")
      .orderBy("recommendation.id", "desc").limit(input.limit + 1).execute()
    return {
      data: rows.slice(0, input.limit).map((row) => ({
        id: row.id,
        runId: row.recommendation_run_id,
        calculationVersion: row.calculation_version,
        configuration: row.configuration,
        type: row.recommendation_type,
        product: { id: row.product_id, name: row.product_name },
        evidenceMetrics: row.evidence_metrics,
        proposedValue: row.proposed_value,
        confidenceScore: row.confidence_score === null
          ? null : Number(row.confidence_score),
        confidenceLabel: row.confidence_label,
        state: row.state,
        reviewer: row.reviewer_id && row.reviewer_name
          ? { id: row.reviewer_id, name: row.reviewer_name }
          : null,
        reviewedAt: row.reviewed_at?.toISOString() ?? null,
        reviewReason: row.review_reason,
        createdAt: row.created_at.toISOString(),
      })),
      hasMore: rows.length > input.limit,
    }
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    key: string,
    hash: string,
  ): Promise<Recommendation | null> {
    const route = `POST /api/v1/intelligence/recommendations/${id}/review`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.updateTable("recommendations").set({
        state: input.decision,
        reviewer_id: user.id,
        reviewed_at: new Date(),
        review_reason: input.reason,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("state", "=", "pending").returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "recommendation.reviewed",
        entityType: "recommendation",
        entityId: id,
        reason: input.reason,
        after: { state: input.decision },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    if (!result) return null
    return this.getRecommendation(user.tenantId, result)
  }

  private async getRecommendation(
    tenantId: string,
    id: string,
  ): Promise<Recommendation | null> {
    const page = await this.listRecommendations(tenantId, { limit: 1, id })
    return page.data[0] ?? null
  }
}
