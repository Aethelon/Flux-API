import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CancelStockCountBodySchema,
  ConfirmStockCountBodySchema,
  CreateStockCountBodySchema,
  IdempotencyHeadersSchema,
  StockCountIdParamsSchema,
  StockCountListQuerySchema,
  StockCountListSchema,
  StockCountSchema,
} from "./schemas.js"

function authenticated(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) throw new Error("Authentication hook did not set request.auth")
  return user
}

const ErrorResponses = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
}

export const stockCountRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.addHook("preHandler", app.authenticate)

  app.get(
    "/inventory/counts",
    {
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        querystring: StockCountListQuerySchema,
        response: {
          200: StockCountListSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.stockCountService.list(
      authenticated(request.auth).tenantId,
      {
        page: Number(request.query.page ?? 1),
        pageSize: Number(request.query.pageSize ?? 25),
        ...(request.query.status ? { status: request.query.status } : {}),
      },
    ),
  )

  app.get(
    "/inventory/counts/:countId",
    {
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        params: StockCountIdParamsSchema,
        response: {
          200: StockCountSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.stockCountService.get(
      authenticated(request.auth).tenantId,
      request.params.countId,
    ),
  )

  app.post(
    "/inventory/counts",
    {
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        body: CreateStockCountBodySchema,
        response: {
          201: StockCountSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const count = await app.stockCountService.create(
        authenticated(request.auth),
        request.body,
        request.headers["idempotency-key"],
      )
      return reply.status(201).send(count)
    },
  )

  app.post(
    "/inventory/counts/:countId/confirm",
    {
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: StockCountIdParamsSchema,
        body: ConfirmStockCountBodySchema,
        response: {
          200: StockCountSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.stockCountService.confirm(
      authenticated(request.auth),
      request.params.countId,
      request.body,
      request.headers["idempotency-key"],
    ),
  )

  app.post(
    "/inventory/counts/:countId/cancel",
    {
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: StockCountIdParamsSchema,
        body: CancelStockCountBodySchema,
        response: {
          200: StockCountSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.stockCountService.cancel(
      authenticated(request.auth),
      request.params.countId,
      request.body,
      request.headers["idempotency-key"],
    ),
  )

  done()
}
