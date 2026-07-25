import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CancelPurchaseOrderBodySchema,
  CreateGoodsReceiptBodySchema,
  CreatePurchaseOrderBodySchema,
  CreateSupplierBodySchema,
  GoodsReceiptSchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  PageQuerySchema,
  ProductSupplierBodySchema,
  ProductSupplierSchema,
  PurchaseOrderPageSchema,
  PurchaseOrderSchema,
  ReverseGoodsReceiptBodySchema,
  SupplierPageSchema,
  SupplierProductParamsSchema,
  SupplierSchema,
  UpdateSupplierBodySchema,
  VersionBodySchema,
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

export const supplyRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const admin = app.authorize(["admin"])

  app.get("/suppliers", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], querystring: PageQuerySchema,
      response: { 200: SupplierPageSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema },
    },
  }, async (request) => app.supplyService.listSuppliers(
    user(request.auth).tenantId,
    Number(request.query.page ?? 1),
    Number(request.query.pageSize ?? 25),
    request.query.search,
  ))

  app.get("/suppliers/:id", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], params: IdParamsSchema,
      response: { 200: SupplierSchema, ...Errors },
    },
  }, async (request) => app.supplyService.getSupplier(user(request.auth).tenantId, request.params.id))

  app.post("/suppliers", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreateSupplierBodySchema,
      response: { 201: SupplierSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.supplyService.createSupplier(
    user(request.auth), request.body, request.headers["idempotency-key"],
  )))

  app.patch("/suppliers/:id", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema, body: UpdateSupplierBodySchema,
      response: { 200: SupplierSchema, ...Errors },
    },
  }, async (request) => app.supplyService.updateSupplier(
    user(request.auth), request.params.id, request.body, request.headers["idempotency-key"],
  ))

  app.get("/suppliers/:id/products", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], params: IdParamsSchema,
      querystring: Type.Object({
        history: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
      }),
      response: { 200: Type.Array(ProductSupplierSchema), ...Errors },
    },
  }, async (request) => app.supplyService.listProductSuppliers(
    user(request.auth).tenantId, request.params.id, request.query.history === "true",
  ))

  app.post("/suppliers/:id/products", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema, body: ProductSupplierBodySchema,
      response: { 201: ProductSupplierSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(
    await app.supplyService.createProductSupplier(
      user(request.auth), request.params.id, request.body, request.headers["idempotency-key"],
    ),
  ))

  app.patch("/suppliers/:supplierId/products/:relationId", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: SupplierProductParamsSchema,
      body: ProductSupplierBodySchema, response: { 200: ProductSupplierSchema, ...Errors },
    },
  }, async (request) => app.supplyService.replaceProductSupplier(
    user(request.auth), request.params.supplierId, request.params.relationId,
    request.body, request.headers["idempotency-key"],
  ))

  app.delete("/suppliers/:supplierId/products/:relationId", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: SupplierProductParamsSchema,
      response: { 204: Type.Null(), ...Errors },
    },
  }, async (request, reply) => {
    await app.supplyService.closeProductSupplier(
      user(request.auth), request.params.supplierId, request.params.relationId,
      request.headers["idempotency-key"],
    )
    return reply.status(204).send(null)
  })

  app.get("/purchase-orders", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], querystring: PageQuerySchema,
      response: { 200: PurchaseOrderPageSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema },
    },
  }, async (request) => app.supplyService.listPurchaseOrders(
    user(request.auth).tenantId,
    Number(request.query.page ?? 1),
    Number(request.query.pageSize ?? 25),
  ))

  app.get("/purchase-orders/:id", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], params: IdParamsSchema,
      response: { 200: PurchaseOrderSchema, ...Errors },
    },
  }, async (request) => app.supplyService.getPurchaseOrder(
    user(request.auth).tenantId, request.params.id,
  ))

  app.post("/purchase-orders", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreatePurchaseOrderBodySchema,
      response: { 201: PurchaseOrderSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(
    await app.supplyService.createPurchaseOrder(
      user(request.auth), request.body, request.headers["idempotency-key"],
    ),
  ))

  app.post("/purchase-orders/:id/submit", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema, body: VersionBodySchema,
      response: { 200: PurchaseOrderSchema, ...Errors },
    },
  }, async (request) => app.supplyService.submitPurchaseOrder(
    user(request.auth), request.params.id, request.body.version,
    request.headers["idempotency-key"],
  ))

  app.post("/purchase-orders/:id/cancel", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: CancelPurchaseOrderBodySchema, response: { 200: PurchaseOrderSchema, ...Errors },
    },
  }, async (request) => app.supplyService.cancelPurchaseOrder(
    user(request.auth), request.params.id, request.body.version, request.body.reason,
    request.headers["idempotency-key"],
  ))

  app.post("/goods-receipts", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreateGoodsReceiptBodySchema,
      response: { 201: GoodsReceiptSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(
    await app.supplyService.createGoodsReceipt(
      user(request.auth), request.body, request.headers["idempotency-key"],
    ),
  ))

  app.get("/goods-receipts/:id", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }], params: IdParamsSchema,
      response: { 200: GoodsReceiptSchema, ...Errors },
    },
  }, async (request) => app.supplyService.getGoodsReceipt(
    user(request.auth).tenantId, request.params.id,
  ))

  app.post("/goods-receipts/:id/reverse", {
    preHandler: admin,
    schema: {
      tags: ["Supply"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, params: IdParamsSchema,
      body: ReverseGoodsReceiptBodySchema,
      response: { 200: GoodsReceiptSchema, ...Errors },
    },
  }, async (request) => app.supplyService.reverseGoodsReceipt(
    user(request.auth), request.params.id, request.body.reason,
    request.headers["idempotency-key"],
  ))

  done()
}
