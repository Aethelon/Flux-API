import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  AiInsightPageSchema,
  AiInsightQuerySchema,
  AiInsightSchema,
  AiJobSchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  ReviewAiInsightBodySchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const aiRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/intelligence/insights", {
    preHandler: app.authorize(["admin"]),
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
    preHandler: app.authorize(["admin"]),
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
    ),
  ))

  app.post("/intelligence/insights/:id/review", {
    preHandler: app.authorize(["admin"]),
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
