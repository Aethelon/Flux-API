import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  IntelligenceCursor,
  IntelligenceRepository,
} from "./intelligence-repository.js"
import type {
  AnalyticsJob,
  ForecastPage,
  Recommendation,
  RecommendationPage,
} from "./types.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function cursor(value: string): IntelligenceCursor {
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
    throw new AppError(400, "INVALID_CURSOR", "The intelligence cursor is invalid.")
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

export class IntelligenceService {
  constructor(private readonly repository: IntelligenceRepository) {}

  createForecastRun(
    user: AuthenticatedUser,
    input: { productId?: string; includeRevenue?: boolean },
    idempotencyKey: string,
  ): Promise<AnalyticsJob> {
    const normalized = {
      runType: "forecasts",
      ...(input.productId ? { productId: input.productId } : {}),
      includeRevenue: input.includeRevenue ?? input.productId === undefined,
    }
    return this.repository.createJob(
      user,
      normalized,
      "POST /api/v1/intelligence/forecasts/runs",
      idempotencyKey,
      hash(normalized),
    )
  }

  createRecommendationRun(
    user: AuthenticatedUser,
    idempotencyKey: string,
  ): Promise<AnalyticsJob> {
    const normalized = { runType: "recommendations" }
    return this.repository.createJob(
      user,
      normalized,
      "POST /api/v1/intelligence/recommendations/runs",
      idempotencyKey,
      hash(normalized),
    )
  }

  async getJob(user: AuthenticatedUser, id: string): Promise<AnalyticsJob> {
    const job = await this.repository.getJob(user.tenantId, id)
    if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Analytics job was not found.")
    return job
  }

  async listForecasts(
    user: AuthenticatedUser,
    input: {
      limit?: string
      cursor?: string
      targetType?: "product_demand" | "monthly_revenue"
      productId?: string
      publishedOnly?: string
    },
  ): Promise<ForecastPage> {
    const result = await this.repository.listForecasts(user.tenantId, {
      limit: input.limit ? Number(input.limit) : 20,
      ...(input.cursor ? { cursor: cursor(input.cursor) } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
      publishedOnly: input.publishedOnly === undefined
        ? true
        : input.publishedOnly === "true",
    })
    return {
      data: result.data,
      nextCursor: nextCursor(result.hasMore, result.data.at(-1)),
    }
  }

  async listRecommendations(
    user: AuthenticatedUser,
    input: {
      limit?: string
      cursor?: string
      type?: "replenishment" | "promotion" | "overstock_review"
      state?: Recommendation["state"]
      productId?: string
    },
  ): Promise<RecommendationPage> {
    const result = await this.repository.listRecommendations(user.tenantId, {
      limit: input.limit ? Number(input.limit) : 20,
      ...(input.cursor ? { cursor: cursor(input.cursor) } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.state ? { state: input.state } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
    })
    return {
      data: result.data,
      nextCursor: nextCursor(result.hasMore, result.data.at(-1)),
    }
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    input: { decision: "accepted" | "rejected"; reason: string },
    idempotencyKey: string,
  ): Promise<Recommendation> {
    const normalized = {
      decision: input.decision,
      reason: input.reason.trim(),
    }
    if (normalized.reason.length < 3) {
      throw new AppError(400, "REASON_REQUIRED", "A review reason is required.")
    }
    const recommendation = await this.repository.review(
      user,
      id,
      normalized,
      idempotencyKey,
      hash(normalized),
    )
    if (!recommendation) {
      throw new AppError(
        409,
        "RECOMMENDATION_NOT_PENDING",
        "Recommendation is unavailable or was already reviewed.",
      )
    }
    return recommendation
  }
}
