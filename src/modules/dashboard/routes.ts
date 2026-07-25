import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { DashboardQuerySchema, DashboardSchema } from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const dashboardRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/dashboard", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Dashboard"],
      security: [{ bearerAuth: [] }],
      querystring: DashboardQuerySchema,
      response: {
        200: DashboardSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.dashboardService.get(user(request.auth), request.query))

  done()
}
