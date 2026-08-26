import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  CreateCustomerBodySchema,
  CreateEmployeeBodySchema,
  CustomerPageSchema,
  CustomerSchema,
  EmployeePageSchema,
  EmployeeSchema,
  IdempotencyHeadersSchema,
  PeopleListQuerySchema,
  PersonIdParamsSchema,
  UpdateCustomerBodySchema,
  UpdateEmployeeBodySchema,
  VersionQuerySchema,
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

export const peopleRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const readCustomers = app.authorizeAnyPermission([
    "customers.view", "orders.view", "pos.view", "history.view",
  ])
  const manageCustomers = app.authorizePermission("customers.view")
  app.get("/customers", {
    preHandler: readCustomers,
    schema: {
      tags: ["Customers"],
      security: [{ bearerAuth: [] }],
      querystring: PeopleListQuerySchema,
      response: { 200: CustomerPageSchema, 401: ErrorResponseSchema },
    },
  }, async (request) => app.peopleService.listCustomers(user(request.auth).tenantId, {
    page: Number(request.query.page ?? 1),
    pageSize: Number(request.query.pageSize ?? 25),
    ...(request.query.search ? { search: request.query.search } : {}),
    ...(request.query.status ? { status: request.query.status } : {}),
  }))

  app.get("/customers/:id", {
    preHandler: readCustomers,
    schema: {
      tags: ["Customers"],
      security: [{ bearerAuth: [] }],
      params: PersonIdParamsSchema,
      response: { 200: CustomerSchema, 401: ErrorResponseSchema, 404: ErrorResponseSchema },
    },
  }, async (request) => app.peopleService.getCustomer(user(request.auth).tenantId, request.params.id))

  app.post("/customers", {
    preHandler: manageCustomers,
    schema: {
      tags: ["Customers"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateCustomerBodySchema,
      response: { 201: CustomerSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.peopleService.createCustomer(
    user(request.auth),
    request.body,
    request.headers["idempotency-key"],
  )))

  app.patch("/customers/:id", {
    preHandler: manageCustomers,
    schema: {
      tags: ["Customers"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: PersonIdParamsSchema,
      body: UpdateCustomerBodySchema,
      response: { 200: CustomerSchema, ...Errors },
    },
  }, async (request) => app.peopleService.updateCustomer(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  ))

  app.delete("/customers/:id", {
    preHandler: manageCustomers,
    schema: {
      tags: ["Customers"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: PersonIdParamsSchema,
      querystring: VersionQuerySchema,
      response: { 204: Type.Null(), ...Errors },
    },
  }, async (request, reply) => {
    await app.peopleService.archiveCustomer(
      user(request.auth),
      request.params.id,
      Number(request.query.version),
      request.headers["idempotency-key"],
    )
    return reply.status(204).send(null)
  })

  const admin = app.authorize(["admin"])

  app.get("/employees", {
    preHandler: admin,
    schema: {
      tags: ["Employees"],
      security: [{ bearerAuth: [] }],
      querystring: PeopleListQuerySchema,
      response: { 200: EmployeePageSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema },
    },
  }, async (request) => app.peopleService.listEmployees(user(request.auth).tenantId, {
    page: Number(request.query.page ?? 1),
    pageSize: Number(request.query.pageSize ?? 25),
    ...(request.query.search ? { search: request.query.search } : {}),
    ...(request.query.status ? { status: request.query.status } : {}),
  }))

  app.get("/employees/:id", {
    preHandler: admin,
    schema: {
      tags: ["Employees"],
      security: [{ bearerAuth: [] }],
      params: PersonIdParamsSchema,
      response: {
        200: EmployeeSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.peopleService.getEmployee(user(request.auth).tenantId, request.params.id))

  app.post("/employees", {
    preHandler: admin,
    schema: {
      tags: ["Employees"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      body: CreateEmployeeBodySchema,
      response: { 201: EmployeeSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.peopleService.createEmployee(
    user(request.auth),
    request.body,
    request.headers["idempotency-key"],
  )))

  app.patch("/employees/:id", {
    preHandler: admin,
    schema: {
      tags: ["Employees"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: PersonIdParamsSchema,
      body: UpdateEmployeeBodySchema,
      response: { 200: EmployeeSchema, ...Errors },
    },
  }, async (request) => app.peopleService.updateEmployee(
    user(request.auth),
    request.params.id,
    request.body,
    request.headers["idempotency-key"],
  ))

  app.delete("/employees/:id", {
    preHandler: admin,
    schema: {
      tags: ["Employees"],
      security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema,
      params: PersonIdParamsSchema,
      querystring: VersionQuerySchema,
      response: { 204: Type.Null(), ...Errors },
    },
  }, async (request, reply) => {
    await app.peopleService.archiveEmployee(
      user(request.auth),
      request.params.id,
      Number(request.query.version),
      request.headers["idempotency-key"],
    )
    return reply.status(204).send(null)
  })

  done()
}
