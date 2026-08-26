import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  BalanceListQuerySchema,
  CreateManualMovementBodySchema,
  IdempotencyHeadersSchema,
  InventoryBalanceListSchema,
  InventoryBalanceSchema,
  MovementListQuerySchema,
  ProductIdParamsSchema,
  StockMovementListSchema,
  StockMovementSchema,
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

export const inventoryRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const readBalances = app.authorizeAnyPermission([
    "inventory.view", "pos.view", "dashboard.view",
  ])
  const manageInventory = app.authorizePermission("inventory.view")

  app.get(
    "/inventory/balances",
    {
      preHandler: readBalances,
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        querystring: BalanceListQuerySchema,
        response: {
          200: InventoryBalanceListSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.inventoryService.listBalances(
      authenticated(request.auth).tenantId,
      {
        page: Number(request.query.page ?? 1),
        pageSize: Number(request.query.pageSize ?? 25),
        ...(request.query.search ? { search: request.query.search } : {}),
        ...(request.query.status ? { status: request.query.status } : {}),
      },
    ),
  )

  app.get(
    "/inventory/balances/:productId",
    {
      preHandler: readBalances,
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        params: ProductIdParamsSchema,
        response: {
          200: InventoryBalanceSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.inventoryService.getBalance(
      authenticated(request.auth).tenantId,
      request.params.productId,
    ),
  )

  app.get(
    "/inventory/movements",
    {
      preHandler: manageInventory,
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        querystring: MovementListQuerySchema,
        response: {
          200: StockMovementListSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.inventoryService.listMovements(
      authenticated(request.auth).tenantId,
      {
        limit: Number(request.query.limit ?? 25),
        ...(request.query.productId ? { productId: request.query.productId } : {}),
        ...(request.query.type ? { type: request.query.type } : {}),
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
      },
    ),
  )

  app.post(
    "/inventory/movements",
    {
      preHandler: manageInventory,
      schema: {
        tags: ["Inventory"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        body: CreateManualMovementBodySchema,
        response: {
          201: StockMovementSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const movement = await app.inventoryService.postManualMovement(
        authenticated(request.auth),
        request.body,
        request.headers["idempotency-key"],
      )
      return reply.status(201).send(movement)
    },
  )

  done()
}
