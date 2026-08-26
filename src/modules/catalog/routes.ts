import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CategorySchema,
  CostHistorySchema,
  CreateCategoryBodySchema,
  CreateProductBodySchema,
  CreateUnitBodySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  IncludeArchivedQuerySchema,
  PriceHistorySchema,
  ProductListQuerySchema,
  ProductListSchema,
  ProductSchema,
  UnitSchema,
  UpdateProductBodySchema,
  UpdateUnitBodySchema,
  VersionQuerySchema,
  VersionedCategoryBodySchema,
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

export const catalogRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const accessSettings = app.authenticate
  const readProducts = app.authorizeAnyPermission([
    "inventory.view", "pos.view", "dashboard.view",
  ])
  const manageProducts = app.authorizePermission("inventory.view")

  app.get(
    "/categories",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        querystring: IncludeArchivedQuerySchema,
        response: {
          200: Type.Array(CategorySchema),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = authenticated(request.auth)
      return app.catalogService.listCategories(
        user.tenantId,
        request.query.includeArchived === "true",
      )
    },
  )

  app.get(
    "/categories/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: CategorySchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.getCategory(
      authenticated(request.auth).tenantId,
      request.params.id,
    ),
  )

  app.post(
    "/categories",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        body: CreateCategoryBodySchema,
        response: {
          201: CategorySchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const category = await app.catalogService.createCategory(
        authenticated(request.auth),
        request.body,
        request.headers["idempotency-key"],
      )
      return reply.status(201).send(category)
    },
  )

  app.patch(
    "/categories/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        body: VersionedCategoryBodySchema,
        response: {
          200: CategorySchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.catalogService.updateCategory(
      authenticated(request.auth),
      request.params.id,
      request.body,
      request.headers["idempotency-key"],
    ),
  )

  app.delete(
    "/categories/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        querystring: VersionQuerySchema,
        response: {
          204: Type.Null(),
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await app.catalogService.archiveCategory(
        authenticated(request.auth),
        request.params.id,
        Number(request.query.version),
        request.headers["idempotency-key"],
      )
      return reply.status(204).send(null)
    },
  )

  app.get(
    "/units",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        querystring: IncludeArchivedQuerySchema,
        response: {
          200: Type.Array(UnitSchema),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const user = authenticated(request.auth)
      return app.catalogService.listUnits(
        user.tenantId,
        request.query.includeArchived === "true",
      )
    },
  )

  app.get(
    "/units/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: UnitSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.getUnit(
      authenticated(request.auth).tenantId,
      request.params.id,
    ),
  )

  app.post(
    "/units",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        body: CreateUnitBodySchema,
        response: {
          201: UnitSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const unit = await app.catalogService.createUnit(
        authenticated(request.auth),
        request.body,
        request.headers["idempotency-key"],
      )
      return reply.status(201).send(unit)
    },
  )

  app.patch(
    "/units/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        body: UpdateUnitBodySchema,
        response: {
          200: UnitSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.catalogService.updateUnit(
      authenticated(request.auth),
      request.params.id,
      request.body,
      request.headers["idempotency-key"],
    ),
  )

  app.delete(
    "/units/:id",
    {
      preHandler: accessSettings,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        querystring: VersionQuerySchema,
        response: {
          204: Type.Null(),
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await app.catalogService.archiveUnit(
        authenticated(request.auth),
        request.params.id,
        Number(request.query.version),
        request.headers["idempotency-key"],
      )
      return reply.status(204).send(null)
    },
  )

  app.get(
    "/products",
    {
      preHandler: readProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        querystring: ProductListQuerySchema,
        response: {
          200: ProductListSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.listProducts(
      authenticated(request.auth).tenantId,
      {
        page: Number(request.query.page ?? "1"),
        pageSize: Number(request.query.pageSize ?? "20"),
        ...(request.query.search === undefined ? {} : { search: request.query.search }),
        ...(request.query.categoryId === undefined
          ? {}
          : { categoryId: request.query.categoryId }),
        ...(request.query.type === undefined ? {} : { type: request.query.type }),
        ...(request.query.active === undefined
          ? {}
          : { active: request.query.active === "true" }),
      },
    ),
  )

  app.get(
    "/products/:id",
    {
      preHandler: readProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: ProductSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.getProduct(
      authenticated(request.auth).tenantId,
      request.params.id,
    ),
  )

  app.post(
    "/products",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        body: CreateProductBodySchema,
        response: {
          201: ProductSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const product = await app.catalogService.createProduct(
        authenticated(request.auth),
        request.body,
        request.headers["idempotency-key"],
      )
      return reply.status(201).send(product)
    },
  )

  app.patch(
    "/products/:id",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        body: UpdateProductBodySchema,
        response: {
          200: ProductSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request) => app.catalogService.updateProduct(
      authenticated(request.auth),
      request.params.id,
      request.body,
      request.headers["idempotency-key"],
    ),
  )

  app.delete(
    "/products/:id",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeadersSchema,
        params: IdParamsSchema,
        querystring: VersionQuerySchema,
        response: {
          204: Type.Null(),
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await app.catalogService.archiveProduct(
        authenticated(request.auth),
        request.params.id,
        Number(request.query.version),
        request.headers["idempotency-key"],
      )
      return reply.status(204).send(null)
    },
  )

  app.get(
    "/products/:id/price-history",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: PriceHistorySchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.listPriceHistory(
      authenticated(request.auth).tenantId,
      request.params.id,
    ),
  )

  app.get(
    "/products/:id/cost-history",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["Catalog"],
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        response: {
          200: CostHistorySchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.catalogService.listCostHistory(
      authenticated(request.auth).tenantId,
      request.params.id,
    ),
  )

  done()
}
