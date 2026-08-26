import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import { CreateJobRoleBodySchema, IdempotencyHeadersSchema, IdParamsSchema, JobRoleSchema, UpdateJobRoleBodySchema, VersionQuerySchema } from "./schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

export const jobRoleRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const admin = app.authorize(["admin"])
  app.get("/job-role-permissions", { preHandler: admin, schema: { response: { 200: Type.Array(Type.Object({ key: Type.String(), group: Type.String(), label: Type.String() })) } } }, () => app.jobRoleService.permissions())
  app.get("/job-roles", { preHandler: admin, schema: { response: { 200: Type.Array(JobRoleSchema), 401: ErrorResponseSchema, 403: ErrorResponseSchema } } }, async (request) => app.jobRoleService.list(user(request.auth).tenantId))
  app.post("/job-roles", { preHandler: admin, schema: { headers: IdempotencyHeadersSchema, body: CreateJobRoleBodySchema, response: { 201: JobRoleSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema } } }, async (request, reply) => reply.status(201).send(await app.jobRoleService.create(user(request.auth), request.body, request.headers["idempotency-key"])))
  app.patch("/job-roles/:id", { preHandler: admin, schema: { headers: IdempotencyHeadersSchema, params: IdParamsSchema, body: UpdateJobRoleBodySchema, response: { 200: JobRoleSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema } } }, async (request) => app.jobRoleService.update(user(request.auth), request.params.id, request.body, request.headers["idempotency-key"]))
  app.delete("/job-roles/:id", { preHandler: admin, schema: { headers: IdempotencyHeadersSchema, params: IdParamsSchema, querystring: VersionQuerySchema, response: { 204: Type.Null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema } } }, async (request, reply) => { await app.jobRoleService.archive(user(request.auth), request.params.id, Number(request.query.version), request.headers["idempotency-key"]); return reply.status(204).send(null) })
  done()
}
