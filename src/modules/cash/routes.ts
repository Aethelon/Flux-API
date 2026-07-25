import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import type { AuthenticatedUser } from "../auth/types.js"
import {
  AssignmentBodySchema,
  AssignmentSchema,
  CashAmountBodySchema,
  CloseSessionBodySchema,
  CreateRegisterBodySchema,
  IdempotencyHeadersSchema,
  IdParamsSchema,
  ManualMovementBodySchema,
  MyRegisterSchema,
  OpenSessionBodySchema,
  PageQuerySchema,
  RegisterSchema,
  SessionSchema,
  UpdateRegisterBodySchema,
} from "./schemas.js"

function user(auth: AuthenticatedUser | null): AuthenticatedUser {
  if (!auth) throw new Error("Authentication hook did not set request.auth")
  return auth
}

const Errors = {
  400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema,
  404: ErrorResponseSchema, 409: ErrorResponseSchema,
}

export const cashRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  const admin = app.authorize(["admin"])

  app.get("/cash-registers", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }],
      response: { 200: Type.Array(RegisterSchema), 401: ErrorResponseSchema, 403: ErrorResponseSchema },
    },
  }, async (request) => app.cashService.listRegisters(user(request.auth).tenantId))

  app.post("/cash-registers", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }],
      headers: IdempotencyHeadersSchema, body: CreateRegisterBodySchema,
      response: { 201: RegisterSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.cashService.createRegister(
    user(request.auth), request.body, request.headers["idempotency-key"],
  )))

  app.patch("/cash-registers/:id", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      params: IdParamsSchema, body: UpdateRegisterBodySchema,
      response: { 200: RegisterSchema, ...Errors },
    },
  }, async (request) => app.cashService.updateRegister(
    user(request.auth), request.params.id, request.body, request.headers["idempotency-key"],
  ))

  app.get("/cash-register-assignments", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }],
      querystring: Type.Object({
        history: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
      }),
      response: {
        200: Type.Array(AssignmentSchema), 401: ErrorResponseSchema, 403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.cashService.listAssignments(
    user(request.auth).tenantId, request.query.history !== "true",
  ))

  app.post("/cash-register-assignments", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: AssignmentBodySchema, response: { 201: AssignmentSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.cashService.assign(
    user(request.auth), request.body, request.headers["idempotency-key"],
  )))

  app.get("/cash-registers/me", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }],
      response: {
        200: MyRegisterSchema, 401: ErrorResponseSchema, 404: ErrorResponseSchema,
      },
    },
  }, async (request) => app.cashService.myRegister(user(request.auth)))

  app.post("/cash-registers/me/open", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: OpenSessionBodySchema, response: { 201: SessionSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.cashService.open(
    user(request.auth), request.body.openingAmountCents, request.headers["idempotency-key"],
  )))

  for (const operation of ["supplies", "withdrawals"] as const) {
    app.post(`/cash-registers/me/${operation}`, {
      preHandler: app.authenticate,
      schema: {
        tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
        body: CashAmountBodySchema, response: { 200: SessionSchema, ...Errors },
      },
    }, async (request) => app.cashService.movement(
      user(request.auth),
      {
        type: operation === "supplies" ? "supply" : "withdrawal",
        amountCents: request.body.amountCents,
        reason: request.body.reason,
      },
      request.headers["idempotency-key"],
    ))
  }

  app.post("/cash-registers/me/close", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: CloseSessionBodySchema, response: { 200: SessionSchema, ...Errors },
    },
  }, async (request) => app.cashService.close(
    user(request.auth), request.body, request.headers["idempotency-key"],
  ))

  app.get("/cash-sessions/current", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }],
      response: { 200: SessionSchema, 401: ErrorResponseSchema, 404: ErrorResponseSchema },
    },
  }, async (request) => app.cashService.current(user(request.auth)))

  app.post("/cash-sessions/open", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: OpenSessionBodySchema, response: { 201: SessionSchema, ...Errors },
    },
  }, async (request, reply) => reply.status(201).send(await app.cashService.open(
    user(request.auth), request.body.openingAmountCents, request.headers["idempotency-key"],
  )))

  app.post("/cash-sessions/current/movements", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: ManualMovementBodySchema, response: { 200: SessionSchema, ...Errors },
    },
  }, async (request) => app.cashService.movement(
    user(request.auth), request.body, request.headers["idempotency-key"],
  ))

  app.post("/cash-sessions/current/close", {
    preHandler: app.authenticate,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
      body: CloseSessionBodySchema, response: { 200: SessionSchema, ...Errors },
    },
  }, async (request) => app.cashService.close(
    user(request.auth), request.body, request.headers["idempotency-key"],
  ))

  app.get("/cash-sessions", {
    preHandler: admin,
    schema: {
      tags: ["Cash"], security: [{ bearerAuth: [] }], querystring: PageQuerySchema,
      response: {
        200: Type.Object({
          data: Type.Array(SessionSchema), page: Type.Integer(),
          pageSize: Type.Integer(), total: Type.Integer(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
  }, async (request) => app.cashService.listSessions(
    user(request.auth).tenantId,
    Number(request.query.page ?? 1),
    Number(request.query.pageSize ?? 25),
  ))

  for (const operation of ["supplies", "withdrawals"] as const) {
    app.post(`/cash-sessions/:id/${operation}`, {
      preHandler: admin,
      schema: {
        tags: ["Cash"], security: [{ bearerAuth: [] }], headers: IdempotencyHeadersSchema,
        params: IdParamsSchema, body: CashAmountBodySchema,
        response: { 200: SessionSchema, ...Errors },
      },
    }, async (request) => app.cashService.adminMovement(
      user(request.auth),
      request.params.id,
      {
        type: operation === "supplies" ? "supply" : "withdrawal",
        amountCents: request.body.amountCents,
        reason: request.body.reason,
      },
      request.headers["idempotency-key"],
    ))
  }

  done()
}
