import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  HistoryKpisQuerySchema,
  HistoryKpisSchema,
  HistorySalesQuerySchema,
  SaleHistoryPageSchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const historyRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.get("/history/sales", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["History"],
      security: [{ bearerAuth: [] }],
      querystring: HistorySalesQuerySchema,
      response: {
        200: SaleHistoryPageSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.historyService.listSales(user(request.auth), request.query))

  app.get("/history/kpis", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["History"],
      security: [{ bearerAuth: [] }],
      querystring: HistoryKpisQuerySchema,
      response: {
        200: HistoryKpisSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.historyService.getKpis(user(request.auth), request.query))

  done()
}
