import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CreateExportBodySchema,
  ExportJobSchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const exportRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.post("/exports", {
    preHandler: app.authorize(["admin", "funcionario"]),
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["Exports"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateExportBodySchema,
      response: {
        202: ExportJobSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => reply.status(202).send(await app.exportService.create(
    user(request.auth),
    request.body,
    request.headers["idempotency-key"],
  )))

  app.get("/exports/:id", {
    preHandler: app.authorize(["admin", "funcionario"]),
    schema: {
      tags: ["Exports"],
      security: [{ bearerAuth: [] }],
      params: IdParamsSchema,
      response: {
        200: ExportJobSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.exportService.get(user(request.auth), request.params.id))

  app.get("/exports/:id/download", {
    preHandler: app.authorize(["admin", "funcionario"]),
    schema: {
      tags: ["Exports"],
      security: [{ bearerAuth: [] }],
      params: IdParamsSchema,
      response: {
        200: Type.String(),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const artifact = await app.exportService.download(user(request.auth), request.params.id)
    return reply.type(artifact.contentType)
      .header("content-disposition", `attachment; filename="${artifact.filename}"`)
      .header("x-content-sha256", artifact.sha256)
      .send(artifact.content)
  })

  app.get("/jobs/:id", {
    preHandler: app.authorize(["admin"]),
    schema: {
      tags: ["Jobs"],
      security: [{ bearerAuth: [] }],
      params: IdParamsSchema,
      response: {
        200: ExportJobSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.exportService.get(user(request.auth), request.params.id))

  done()
}
