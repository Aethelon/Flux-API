import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  ArchiveBodySchema,
  ColumnSchema,
  CreateColumnBodySchema,
  CreateServiceOrderBodySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  ListQuerySchema,
  ReorderColumnsBodySchema,
  ServiceOrderSchema,
  TransitionBodySchema,
  UpdateColumnBodySchema,
  UpdateServiceOrderBodySchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

const Errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
}

export const serviceOrderRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const readOrders = app.authorizeAnyPermission([
    "orders.view", "dashboard.view", "pos.view", "intelligence.view",
  ])
  const manageOrders = app.authorizePermission("orders.view")
  app.get("/service-order-columns", {
    preHandler: readOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      response: { 200: Type.Array(ColumnSchema), 401: ErrorResponseSchema },
    },
  }, async (request) => app.serviceOrderService.listColumns(user(request.auth)))

  app.post("/service-order-columns", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreateColumnBodySchema,
      response: { 201: ColumnSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(
    await app.serviceOrderService.createColumn(
      user(request.auth), request.body, request.headers["idempotency-key"],
    ),
  ))

  app.patch("/service-order-columns/:id", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: UpdateColumnBodySchema, response: { 200: ColumnSchema, ...Errors },
    },
  }, async (request) => app.serviceOrderService.updateColumn(
    user(request.auth), request.params.id, request.body,
    request.headers["idempotency-key"],
  ))

  app.post("/service-order-columns/reorder", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: ReorderColumnsBodySchema,
      response: { 200: Type.Array(ColumnSchema), ...Errors },
    },
  }, async (request) => app.serviceOrderService.reorderColumns(
    user(request.auth), request.body, request.headers["idempotency-key"],
  ))

  app.post("/service-order-columns/:id/archive", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: ArchiveBodySchema, response: { 204: Type.Null(), ...Errors },
    },
  }, async (request, reply) => {
    await app.serviceOrderService.archiveColumn(
      user(request.auth), request.params.id, request.body,
      request.headers["idempotency-key"],
    )
    return reply.status(204).send(null)
  })

  app.get("/service-orders", {
    preHandler: readOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      querystring: ListQuerySchema,
      response: { 200: Type.Array(ServiceOrderSchema), 401: ErrorResponseSchema },
    },
  }, async (request) => app.serviceOrderService.list(
    user(request.auth), request.query.view === "history",
  ))

  app.get("/service-orders/:id", {
    preHandler: readOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      params: IdParamsSchema,
      response: {
        200: ServiceOrderSchema, 401: ErrorResponseSchema, 404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.serviceOrderService.get(
    user(request.auth).tenantId, request.params.id,
  ))

  app.post("/service-orders", {
    preHandler: manageOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreateServiceOrderBodySchema,
      response: { 201: ServiceOrderSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(
    await app.serviceOrderService.create(
      user(request.auth), request.body, request.headers["idempotency-key"],
    ),
  ))

  app.patch("/service-orders/:id", {
    preHandler: manageOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: UpdateServiceOrderBodySchema,
      response: { 200: ServiceOrderSchema, ...Errors },
    },
  }, async (request) => app.serviceOrderService.update(
    user(request.auth), request.params.id, request.body,
    request.headers["idempotency-key"],
  ))

  app.post("/service-orders/:id/transitions", {
    preHandler: manageOrders,
    schema: {
      tags: ["Service orders"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: TransitionBodySchema,
      response: { 200: ServiceOrderSchema, ...Errors },
    },
  }, async (request) => app.serviceOrderService.transition(
    user(request.auth), request.params.id, request.body,
    request.headers["idempotency-key"],
  ))

  done()
}
