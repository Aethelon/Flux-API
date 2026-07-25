import { sql, type Kysely } from "kysely"
import type { AppConfig } from "../../config/env.js"
import type {
  AiProviderName,
  Database,
} from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  AiProviderError,
  createAiProvider,
  estimatedCostMicroUsd,
} from "./providers.js"
import type {
  AiProvider,
  AiStructuredOutput,
  SanitizedAiInput,
} from "./types.js"
import {
  redactedOutputDigest,
  validateAiOutput,
} from "./validation.js"

interface ClaimedAiJob {
  id: string
  tenantId: string
  runId: string
  provider: AiProviderName
  modelId: string
  input: SanitizedAiInput
  inputHash: string
  promptVersion: string
  schemaVersion: string
  policyVersion: string
  attempts: number
  correlationId: string | null
}

function sanitizedInput(value: unknown): SanitizedAiInput {
  if (typeof value !== "object" || value === null) {
    throw new AppError(400, "INVALID_AI_JOB", "AI job input is invalid.")
  }
  return value as SanitizedAiInput
}

async function claim(
  database: Kysely<Database>,
): Promise<ClaimedAiJob | null> {
  return database.transaction().execute(async (transaction) => {
    const row = await transaction.selectFrom("job_runs as job")
      .innerJoin("ai_runs as run", (join) => join
        .onRef("run.job_run_id", "=", "job.id")
        .onRef("run.tenant_id", "=", "job.tenant_id"))
      .select([
        "job.id",
        "job.tenant_id",
        "job.attempts",
        "job.correlation_id",
        "run.id as run_id",
        "run.provider",
        "run.model_id",
        "run.sanitized_input",
        "run.input_hash",
        "run.prompt_version",
        "run.schema_version",
        "run.policy_version",
      ]).where("job.job_type", "=", "ai")
      .where("job.available_at", "<=", new Date())
      .where((expression) => expression.or([
        expression("job.status", "=", "pending"),
        expression.and([
          expression("job.status", "=", "failed"),
          expression("job.attempts", "<", 3),
        ]),
        expression.and([
          expression("job.status", "=", "processing"),
          expression("job.attempts", "<", 3),
          expression(
            "job.started_at",
            "<",
            new Date(Date.now() - (15 * 60 * 1_000)),
          ),
        ]),
      ])).orderBy("job.available_at").orderBy("job.created_at").orderBy("job.id")
      .forUpdate("job").skipLocked().executeTakeFirst()
    if (!row) return null
    const now = new Date()
    await transaction.updateTable("job_runs").set({
      status: "processing",
      attempts: sql`attempts + 1`,
      started_at: now,
      finished_at: null,
      error_class: null,
      error_message: null,
      updated_at: now,
    }).where("id", "=", row.id).execute()
    await transaction.updateTable("ai_runs").set({
      status: "processing",
      validation_outcome: "pending",
      rejection_reasons: sql`'[]'::jsonb`,
      error_class: null,
      error_message: null,
      started_at: now,
      finished_at: null,
    }).where("id", "=", row.run_id).execute()
    return {
      id: row.id,
      tenantId: row.tenant_id,
      runId: row.run_id,
      provider: row.provider,
      modelId: row.model_id,
      input: sanitizedInput(row.sanitized_input),
      inputHash: row.input_hash,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
      policyVersion: row.policy_version,
      attempts: row.attempts + 1,
      correlationId: row.correlation_id,
    }
  })
}

async function completeJob(
  database: Kysely<Database>,
  job: ClaimedAiJob,
  status: "completed" | "cached" | "rejected",
  count: number,
): Promise<void> {
  const now = new Date()
  await database.updateTable("job_runs").set({
    status: "completed",
    total_count: count,
    processed_count: count,
    cursor: { aiRunId: job.runId, status },
    finished_at: now,
    updated_at: now,
  }).where("id", "=", job.id).execute()
}

async function cached(
  database: Kysely<Database>,
  config: AppConfig,
  job: ClaimedAiJob,
): Promise<boolean> {
  const source = await database.selectFrom("ai_runs").select([
    "id",
    "structured_output",
  ]).where("tenant_id", "=", job.tenantId)
    .where("id", "!=", job.runId)
    .where("input_hash", "=", job.inputHash)
    .where("prompt_version", "=", job.promptVersion)
    .where("schema_version", "=", job.schemaVersion)
    .where("policy_version", "=", job.policyVersion)
    .where("provider", "=", job.provider)
    .where("model_id", "=", job.modelId)
    .where("status", "in", ["completed", "cached"])
    .where(
      "created_at",
      ">=",
      new Date(Date.now() - (config.aiCacheTtlHours * 60 * 60 * 1_000)),
    )
    .orderBy("created_at", "desc").orderBy("id", "desc")
    .executeTakeFirst()
  if (!source?.structured_output) return false
  const insights = await database.selectFrom("ai_insights").select([
    "insight_type",
    "text",
    "severity",
    "source_metric_ids",
    "display_order",
    "requires_human_review",
  ]).where("tenant_id", "=", job.tenantId)
    .where("ai_run_id", "=", source.id)
    .orderBy("display_order").execute()
  const now = new Date()
  await database.transaction().execute(async (transaction) => {
    await transaction.updateTable("ai_runs").set({
      structured_output: source.structured_output,
      status: "cached",
      validation_outcome: "accepted",
      rejection_reasons: sql`'[]'::jsonb`,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      estimated_cost_micro_usd: 0,
      retry_count: 0,
      cache_source_run_id: source.id,
      finished_at: now,
    }).where("id", "=", job.runId).execute()
    if (insights.length > 0) {
      await transaction.insertInto("ai_insights").values(
        insights.map((insight) => ({
          tenant_id: job.tenantId,
          ai_run_id: job.runId,
          insight_type: insight.insight_type,
          text: insight.text,
          severity: insight.severity,
          source_metric_ids: sql`${JSON.stringify(
            insight.source_metric_ids,
          )}::jsonb`,
          display_order: insight.display_order,
          requires_human_review: insight.requires_human_review,
          state: "pending" as const,
          reviewer_id: null,
          reviewed_at: null,
          review_reason: null,
        })),
      ).execute()
    }
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenantId,
      actor_type: "job",
      actor_id: job.id,
      action: "ai.insights.cached",
      entity_type: "ai_run",
      entity_id: job.runId,
      request_id: job.correlationId,
      correlation_id: job.correlationId,
      source: "worker",
      reason: null,
      before_json: null,
      after_json: { sourceRunId: source.id, count: insights.length },
      ip_address: null,
      user_agent: null,
    }).execute()
    await completeJob(transaction, job, "cached", insights.length)
  })
  return true
}

async function budgetAvailable(
  database: Kysely<Database>,
  config: AppConfig,
  job: ClaimedAiJob,
): Promise<boolean> {
  const settings = await database.selectFrom("tenant_settings").select([
    "ai_enabled",
    "ai_daily_token_budget",
    "ai_daily_cost_budget_micro_usd",
  ]).where("tenant_id", "=", job.tenantId).executeTakeFirstOrThrow()
  if (!settings.ai_enabled) return false
  const usage = await database.selectFrom("ai_runs").select([
    sql<string>`coalesce(sum(input_tokens + output_tokens), 0)`.as("tokens"),
    sql<string>`coalesce(sum(estimated_cost_micro_usd), 0)`.as("cost"),
  ]).where("tenant_id", "=", job.tenantId)
    .where(sql<boolean>`
      created_at >= date_trunc(
        'day',
        now() AT TIME ZONE (
          SELECT timezone FROM tenant_settings WHERE tenant_id = ${job.tenantId}
        )
      ) AT TIME ZONE (
        SELECT timezone FROM tenant_settings WHERE tenant_id = ${job.tenantId}
      )
    `).executeTakeFirstOrThrow()
  const estimatedInputTokens = Math.ceil(JSON.stringify(job.input).length / 4)
  const estimatedTokens = estimatedInputTokens + config.aiMaxOutputTokens
  const estimatedCost = estimatedCostMicroUsd(
    job.provider,
    job.modelId,
    estimatedInputTokens,
    config.aiMaxOutputTokens,
  )
  return Number(usage.tokens) + estimatedTokens <= settings.ai_daily_token_budget
    && (
      estimatedCost === null
      || Number(usage.cost) + estimatedCost
        <= Number(settings.ai_daily_cost_budget_micro_usd)
    )
}

function insightRows(
  tenantId: string,
  runId: string,
  output: AiStructuredOutput,
): Array<{
  tenant_id: string
  ai_run_id: string
  insight_type: "summary" | "strength" | "risk" | "recommendation"
  text: string
  severity: "low" | "medium" | "high" | null
  source_metric_ids: string[]
  display_order: number
  requires_human_review: boolean
  state: "pending"
  reviewer_id: null
  reviewed_at: null
  review_reason: null
}> {
  return [
    {
      tenant_id: tenantId,
      ai_run_id: runId,
      insight_type: "summary",
      text: output.summary.text,
      severity: null,
      source_metric_ids: output.summary.sourceMetricIds,
      display_order: 0,
      requires_human_review: true,
      state: "pending",
      reviewer_id: null,
      reviewed_at: null,
      review_reason: null,
    },
    ...output.strengths.map((item, index) => ({
      tenant_id: tenantId,
      ai_run_id: runId,
      insight_type: "strength" as const,
      text: item.text,
      severity: null,
      source_metric_ids: item.sourceMetricIds,
      display_order: index + 1,
      requires_human_review: true,
      state: "pending" as const,
      reviewer_id: null,
      reviewed_at: null,
      review_reason: null,
    })),
    ...output.risks.map((item, index) => ({
      tenant_id: tenantId,
      ai_run_id: runId,
      insight_type: "risk" as const,
      text: item.text,
      severity: item.severity,
      source_metric_ids: item.sourceMetricIds,
      display_order: index + 1,
      requires_human_review: true,
      state: "pending" as const,
      reviewer_id: null,
      reviewed_at: null,
      review_reason: null,
    })),
    ...output.recommendations.map((item, index) => ({
      tenant_id: tenantId,
      ai_run_id: runId,
      insight_type: "recommendation" as const,
      text: item.text,
      severity: null,
      source_metric_ids: item.sourceMetricIds,
      display_order: index + 1,
      requires_human_review: item.requiresHumanReview,
      state: "pending" as const,
      reviewer_id: null,
      reviewed_at: null,
      review_reason: null,
    })),
  ]
}

async function completeGeneration(
  database: Kysely<Database>,
  job: ClaimedAiJob,
  provider: AiProvider,
): Promise<void> {
  if (provider.name !== job.provider || provider.modelId !== job.modelId) {
    throw new AiProviderError(
      "AI_PROVIDER_CONFIGURATION_MISMATCH",
      "AI provider configuration changed after the job was created.",
      false,
    )
  }
  const result = await provider.generate(job.input)
  const inputTokens = result.inputTokens > 0
    ? result.inputTokens : Math.ceil(JSON.stringify(job.input).length / 4)
  const outputTokens = result.outputTokens > 0
    ? result.outputTokens : Math.ceil(JSON.stringify(result.output).length / 4)
  const validation = validateAiOutput(result.output, job.input)
  const now = new Date()
  if (!validation.accepted || !validation.output) {
    const reasons = [
      ...validation.reasons,
      `output_digest:${redactedOutputDigest(result.output)}`,
    ]
    await database.transaction().execute(async (transaction) => {
      await transaction.updateTable("ai_runs").set({
        structured_output: null,
        status: "rejected",
        validation_outcome: "rejected",
        rejection_reasons: sql`${JSON.stringify(reasons)}::jsonb`,
        provider_request_id: result.providerRequestId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        latency_ms: result.latencyMs,
        estimated_cost_micro_usd: estimatedCostMicroUsd(
          job.provider,
          job.modelId,
          inputTokens,
          outputTokens,
        ),
        retry_count: result.retryCount,
        finished_at: now,
      }).where("id", "=", job.runId).execute()
      await transaction.insertInto("audit_events").values({
        tenant_id: job.tenantId,
        actor_type: "job",
        actor_id: job.id,
        action: "ai.insights.rejected",
        entity_type: "ai_run",
        entity_id: job.runId,
        request_id: result.providerRequestId,
        correlation_id: job.correlationId,
        source: "worker",
        reason: validation.reasons.join(","),
        before_json: null,
        after_json: { outputDigest: redactedOutputDigest(result.output) },
        ip_address: null,
        user_agent: null,
      }).execute()
      await completeJob(transaction, job, "rejected", 0)
    })
    return
  }
  const rows = insightRows(job.tenantId, job.runId, validation.output)
  await database.transaction().execute(async (transaction) => {
    await transaction.updateTable("ai_runs").set({
      structured_output: validation.output,
      status: "completed",
      validation_outcome: "accepted",
      rejection_reasons: sql`'[]'::jsonb`,
      provider_request_id: result.providerRequestId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: result.latencyMs,
      estimated_cost_micro_usd: estimatedCostMicroUsd(
        job.provider,
        job.modelId,
        inputTokens,
        outputTokens,
      ),
      retry_count: result.retryCount,
      finished_at: now,
    }).where("id", "=", job.runId).execute()
    await transaction.insertInto("ai_insights").values(rows.map((row) => ({
      ...row,
      source_metric_ids: sql`${JSON.stringify(row.source_metric_ids)}::jsonb`,
    }))).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenantId,
      actor_type: "job",
      actor_id: job.id,
      action: "ai.insights.completed",
      entity_type: "ai_run",
      entity_id: job.runId,
      request_id: result.providerRequestId,
      correlation_id: job.correlationId,
      source: "worker",
      reason: null,
      before_json: null,
      after_json: { count: rows.length },
      ip_address: null,
      user_agent: null,
    }).execute()
    await completeJob(transaction, job, "completed", rows.length)
  })
}

async function fail(
  database: Kysely<Database>,
  job: ClaimedAiJob,
  error: unknown,
  permanent = false,
): Promise<void> {
  const now = new Date()
  const knownError = error instanceof AppError || error instanceof AiProviderError
    ? error : null
  const retryable = !permanent
    && error instanceof AiProviderError
    && error.transient
    && job.attempts < 3
  const code = knownError?.code ?? "AI_GENERATION_FAILED"
  const message = knownError?.message ?? "AI insight generation failed."
  await database.transaction().execute(async (transaction) => {
    await transaction.updateTable("job_runs").set({
      status: "failed",
      attempts: retryable ? job.attempts : 3,
      error_class: code,
      error_message: message,
      available_at: retryable
        ? new Date(now.getTime() + (job.attempts * 30_000))
        : now,
      finished_at: now,
      updated_at: now,
    }).where("id", "=", job.id).execute()
    await transaction.updateTable("ai_runs").set({
      status: code === "AI_BUDGET_EXCEEDED" ? "budget_exceeded" : "failed",
      validation_outcome: "not_run",
      rejection_reasons: sql`'[]'::jsonb`,
      error_class: code,
      error_message: message,
      finished_at: now,
    }).where("id", "=", job.runId).execute()
    await transaction.insertInto("audit_events").values({
      tenant_id: job.tenantId,
      actor_type: "job",
      actor_id: job.id,
      action: "ai.insights.failed",
      entity_type: "ai_run",
      entity_id: job.runId,
      request_id: job.correlationId,
      correlation_id: job.correlationId,
      source: "worker",
      reason: code,
      before_json: null,
      after_json: null,
      ip_address: null,
      user_agent: null,
    }).execute()
  })
}

export async function processPendingAi(
  database: Kysely<Database>,
  config: AppConfig,
  maxJobs = 2,
  provider: AiProvider | null = createAiProvider(config),
): Promise<number> {
  let processed = 0
  while (processed < maxJobs) {
    const job = await claim(database)
    if (!job) break
    try {
      if (await cached(database, config, job)) {
        processed += 1
        continue
      }
      if (!await budgetAvailable(database, config, job)) {
        await fail(
          database,
          job,
          new AppError(
            429,
            "AI_BUDGET_EXCEEDED",
            "The tenant AI budget is unavailable or exhausted.",
          ),
          true,
        )
      } else if (!provider) {
        await fail(
          database,
          job,
          new AppError(503, "AI_DISABLED", "AI insights are not enabled."),
          true,
        )
      } else {
        await completeGeneration(database, job, provider)
      }
    } catch (error) {
      await fail(database, job, error)
    }
    processed += 1
  }
  return processed
}
