import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { AuditPageSchema, AuditQuerySchema } from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const auditRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/audit-events", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Audit"],
      security: [{ bearerAuth: [] }],
      querystring: AuditQuerySchema,
      response: {
        200: AuditPageSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.auditService.list(user(request.auth), request.query))

  done()
}
