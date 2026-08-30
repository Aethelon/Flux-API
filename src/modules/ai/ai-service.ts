import { createHash } from "node:crypto"
import type { Kysely } from "kysely"
import type { AppConfig } from "../../config/env.js"
import type { Database } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  buildSanitizedAiInput,
  publishAiReportSnapshot,
} from "./ai-input.js"
import type { AiCursor, AiRepository } from "./ai-repository.js"
import type {
  AiInsight,
  AiInsightPage,
  AiJob,
  AiReportPeriod,
  AiSettings,
} from "./types.js"
import { inputHash } from "./validation.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function providerConfigured(config: AppConfig): boolean {
  return config.aiProvider === "gemini"
    ? config.geminiApiKey !== null
    : config.aiProvider === "anthropic"
      ? config.anthropicApiKey !== null
      : false
}

function cursor(value: string): AiCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      typeof decoded !== "object"
      || decoded === null
      || !("createdAt" in decoded)
      || !("id" in decoded)
      || typeof decoded.createdAt !== "string"
      || typeof decoded.id !== "string"
      || Number.isNaN(Date.parse(decoded.createdAt))
      || !UUID_PATTERN.test(decoded.id)
    ) throw new Error("Invalid cursor")
    return { createdAt: decoded.createdAt, id: decoded.id }
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "The AI insight cursor is invalid.")
  }
}

function nextCursor(
  hasMore: boolean,
  last: { id: string; createdAt: string } | undefined,
): string | null {
  return hasMore && last
    ? Buffer.from(JSON.stringify({
        createdAt: last.createdAt,
        id: last.id,
      })).toString("base64url")
    : null
}

export class AiService {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly repository: AiRepository,
    private readonly config: AppConfig,
  ) {}

  async getSettings(tenantId: string): Promise<AiSettings> {
    const settings = await this.database.selectFrom("tenant_settings")
      .select("ai_enabled")
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow()
    return {
      enabled: settings.ai_enabled,
      provider: this.config.aiProvider,
      providerConfigured: providerConfigured(this.config),
    }
  }

  async updateSettings(
    user: AuthenticatedUser,
    input: { enabled: boolean },
    idempotencyKey: string,
  ): Promise<AiSettings> {
    if (input.enabled && !providerConfigured(this.config)) {
      throw new AppError(
        409,
        "AI_PROVIDER_NOT_CONFIGURED",
        "Configure an AI provider on the server before enabling AI insights.",
      )
    }
    const route = "PATCH /api/v1/intelligence/settings"
    const requestHash = hash(input)
    await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
      )
      if (replay) return
      const current = await transaction.selectFrom("tenant_settings")
        .select("ai_enabled")
        .where("tenant_id", "=", user.tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow()
      if (current.ai_enabled !== input.enabled) {
        await transaction.updateTable("tenant_settings")
          .set({ ai_enabled: input.enabled, updated_at: new Date() })
          .where("tenant_id", "=", user.tenantId)
          .executeTakeFirstOrThrow()
        await recordDomainEvent(transaction, user, {
          action: "tenant.ai_settings_updated",
          entityType: "tenant_settings",
          entityId: user.tenantId,
          before: { enabled: current.ai_enabled },
          after: { enabled: input.enabled },
        })
      }
      await saveEntityIdempotency(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
        user.tenantId,
        200,
      )
    })
    return this.getSettings(user.tenantId)
  }

  async createRun(
    user: AuthenticatedUser,
    idempotencyKey: string,
    reportPeriod: AiReportPeriod = "monthly",
  ): Promise<AiJob> {
    const provider = this.config.aiProvider
    if (provider === "disabled" || !providerConfigured(this.config)) {
      throw new AppError(503, "AI_DISABLED", "AI insights are not enabled.")
    }
    const settings = await this.database.selectFrom("tenant_settings").select(
      "ai_enabled",
    ).where("tenant_id", "=", user.tenantId).executeTakeFirstOrThrow()
    if (!settings.ai_enabled) {
      throw new AppError(503, "AI_DISABLED", "AI insights are not enabled.")
    }
    const route = "POST /api/v1/intelligence/insights/runs"
    const requestHash = hash({ reportPeriod })
    const replayId = await this.database.transaction().execute(
      (transaction) => replayedEntityId(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
      ),
    )
    if (replayId) {
      const replayed = await this.repository.getJob(user.tenantId, replayId)
      if (!replayed) {
        throw new AppError(
          409,
          "IDEMPOTENCY_RESULT_UNAVAILABLE",
          "The previous request result is not available for replay.",
        )
      }
      return replayed
    }
    await publishAiReportSnapshot(
      this.database,
      user.tenantId,
      reportPeriod,
    )
    const input = await buildSanitizedAiInput(
      this.database,
      user.tenantId,
      reportPeriod,
    )
    if (input.metrics.length === 0) {
      throw new AppError(
        409,
        "AI_INPUT_UNAVAILABLE",
        "Published deterministic metrics are required before AI insights.",
      )
    }
    const providerName = provider
    const modelId = providerName === "gemini"
      ? this.config.geminiModelId : this.config.anthropicModelId
    const digest = inputHash(input)
    return this.repository.createRun(
      user,
      input,
      digest,
      input.metrics.map((metric) => metric.id),
      providerName,
      modelId,
      this.config,
      route,
      idempotencyKey,
      requestHash,
    )
  }

  async getJob(user: AuthenticatedUser, id: string): Promise<AiJob> {
    const job = await this.repository.getJob(user.tenantId, id)
    if (!job) throw new AppError(404, "JOB_NOT_FOUND", "AI job was not found.")
    return job
  }

  async listInsights(
    user: AuthenticatedUser,
    input: {
      limit?: string
      cursor?: string
      state?: AiInsight["state"]
    },
  ): Promise<AiInsightPage> {
    const [result, settings] = await Promise.all([
      this.repository.listInsights(user.tenantId, {
        limit: input.limit ? Number(input.limit) : 20,
        ...(input.cursor ? { cursor: cursor(input.cursor) } : {}),
        ...(input.state ? { state: input.state } : {}),
      }),
      this.database.selectFrom("tenant_settings").select("ai_enabled")
        .where("tenant_id", "=", user.tenantId).executeTakeFirstOrThrow(),
    ])
    return {
      data: result.data,
      nextCursor: nextCursor(result.hasMore, result.data.at(-1)),
      availability: settings.ai_enabled && providerConfigured(this.config)
        ? "available"
        : "unavailable",
      latestRunStatus: result.latestRunStatus,
    }
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    idempotencyKey: string,
  ): Promise<AiInsight> {
    const normalized = {
      decision: input.decision,
      reason: input.reason.trim(),
    }
    if (normalized.reason.length < 3) {
      throw new AppError(400, "REASON_REQUIRED", "A review reason is required.")
    }
    const insight = await this.repository.review(
      user,
      id,
      normalized,
      idempotencyKey,
      hash({ id, ...normalized }),
    )
    if (!insight) {
      throw new AppError(
        409,
        "AI_INSIGHT_NOT_PENDING",
        "AI insight is unavailable or was already reviewed.",
      )
    }
    return insight
  }
}
