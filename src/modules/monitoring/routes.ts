import { timingSafeEqual } from "node:crypto"
import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { AppError } from "../../shared/errors/app-error.js"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"

function authorized(header: string | undefined, expected: string | null): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false
  const received = Buffer.from(header.slice(7))
  const configured = Buffer.from(expected)
  return received.length === configured.length
    && timingSafeEqual(received, configured)
}

export const monitoringRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/metrics", {
    config: {
      rateLimit: false,
    },
    schema: {
      tags: ["Monitoring"],
      response: {
        200: Type.String(),
        401: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!app.config.monitoringToken) {
      throw new AppError(503, "MONITORING_DISABLED", "Monitoring is not configured.")
    }
    if (!authorized(request.headers.authorization, app.config.monitoringToken)) {
      throw new AppError(401, "UNAUTHORIZED", "Missing or invalid monitoring token.")
    }
    return reply.type("text/plain; version=0.0.4; charset=utf-8")
      .send(await app.monitoringService.renderPrometheus())
  })

  done()
}
