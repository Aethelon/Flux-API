import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { AiReportPeriod } from "./types.js"
import {
  AiInsightPageSchema,
  AiInsightQuerySchema,
  AiInsightSchema,
  AiJobSchema,
  AiSettingsSchema,
  CreateAiInsightRunBodySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  ReviewAiInsightBodySchema,
  UpdateAiSettingsBodySchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

function reportPeriod(body: unknown): AiReportPeriod {
  return typeof body === "object"
    && body !== null
    && "period" in body
    && body.period === "quarterly"
    ? "quarterly"
    : "monthly"
}

export const aiRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const admin = app.authorize(["admin"])
  app.get("/intelligence/settings", {
    preHandler: admin,
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      response: {
        200: AiSettingsSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.aiService.getSettings(user(request.auth).tenantId))

  app.patch("/intelligence/settings", {
    preHandler: admin,
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: UpdateAiSettingsBodySchema,
      response: {
        200: AiSettingsSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request) => app.aiService.updateSettings(
    user(request.auth),
    request.body,
    request.headers["idempotency-key"],
  ))

  app.get("/intelligence/insights", {
    preHandler: app.authorizePermission("intelligence.view"),
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      querystring: AiInsightQuerySchema,
      response: {
        200: AiInsightPageSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.aiService.listInsights(
    user(request.auth),
    request.query,
  ))

  app.post("/intelligence/insights/runs", {
    preHandler: app.authorizePermission("intelligence.view"),
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateAiInsightRunBodySchema,
      response: {
        202: AiJobSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => reply.status(202).send(
    await app.aiService.createRun(
      user(request.auth),
      request.headers["idempotency-key"],
      reportPeriod(request.body),
    ),
  ))

  app.post("/intelligence/insights/:id/review", {
    preHandler: app.authorizePermission("intelligence.view"),
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: IdParamsSchema,
      body: ReviewAiInsightBodySchema,
      response: {
        200: AiInsightSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request) => app.aiService.review(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  ))

  done()
}
