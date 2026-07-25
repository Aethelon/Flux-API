import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  AnalyticsJobSchema,
  CreateForecastRunBodySchema,
  ForecastPageSchema,
  ForecastQuerySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  RecommendationPageSchema,
  RecommendationQuerySchema,
  RecommendationSchema,
  ReviewRecommendationBodySchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const intelligenceRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/intelligence/forecasts", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      querystring: ForecastQuerySchema,
      response: {
        200: ForecastPageSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.intelligenceService.listForecasts(
    user(request.auth),
    request.query,
  ))

  app.post("/intelligence/forecasts/runs", {
    preHandler: app.authorize(["admin"]),
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateForecastRunBodySchema,
      response: {
        202: AnalyticsJobSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => reply.status(202).send(
    await app.intelligenceService.createForecastRun(
      user(request.auth),
      request.body,
      request.headers["idempotency-key"],
    ),
  ))

  app.get("/intelligence/recommendations", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      querystring: RecommendationQuerySchema,
      response: {
        200: RecommendationPageSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.intelligenceService.listRecommendations(
    user(request.auth),
    request.query,
  ))

  app.post("/intelligence/recommendations/runs", {
    preHandler: app.authorize(["admin"]),
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      response: {
        202: AnalyticsJobSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => reply.status(202).send(
    await app.intelligenceService.createRecommendationRun(
      user(request.auth),
      request.headers["idempotency-key"],
    ),
  ))

  app.post("/intelligence/recommendations/:id/review", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Intelligence"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: IdParamsSchema,
      body: ReviewRecommendationBodySchema,
      response: {
        200: RecommendationSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request) => app.intelligenceService.review(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  ))

  done()
}
