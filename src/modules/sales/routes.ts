import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CancelSaleBodySchema,
  CreateReturnBodySchema,
  CreateSaleBodySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  SaleReturnSchema,
  SaleSchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

const Errors = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
}

export const salesRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.post("/sales", {
    preHandler: app.authorizePermission("pos.view"),
    schema: {
      tags: ["Sales"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateSaleBodySchema,
      response: { 201: SaleSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.salesService.create(
    user(request.auth),
    request.body,
    request.headers["idempotency-key"],
  )))

  app.get("/sales/:id", {
    preHandler: app.authorizePermission("pos.view"),
    schema: {
      tags: ["Sales"],
      security: [{ bearerAuth: [] }],
      params: IdParamsSchema,
      response: {
        200: SaleSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.salesService.get(user(request.auth).tenantId, request.params.id))

  app.post("/sales/:id/cancel", {
    preHandler: app.authorizePermission("pos.view"),
    schema: {
      tags: ["Sales"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: IdParamsSchema,
      body: CancelSaleBodySchema,
      response: { 200: SaleSchema, ...Errors },
    },
  }, async (request) => app.salesService.cancel(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  ))

  app.post("/sales/:id/returns", {
    preHandler: app.authorizePermission("pos.view"),
    schema: {
      tags: ["Sales"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: IdParamsSchema,
      body: CreateReturnBodySchema,
      response: { 201: SaleReturnSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.salesService.createReturn(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  )))

  done()
}
