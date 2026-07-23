import { sql } from "kysely"
import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"

const HealthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  timestamp: Type.String({ format: "date-time" }),
})

export const healthRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get(
    "/live",
    {
      config: {
        rateLimit: false,
      },
      schema: {
        tags: ["Health"],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    () => ({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
    }),
  )

  app.get(
    "/ready",
    {
      config: {
        rateLimit: false,
      },
      schema: {
        tags: ["Health"],
        response: {
          200: HealthResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await sql`SELECT 1`.execute(app.db)

        return {
          status: "ok" as const,
          timestamp: new Date().toISOString(),
        }
      } catch (error) {
        request.log.error({ err: error }, "Database readiness check failed")

        return reply.status(503).send({
          code: "SERVICE_UNAVAILABLE",
          message: "The database is unavailable.",
          requestId: request.id,
        })
      }
    },
  )

  done()
}
