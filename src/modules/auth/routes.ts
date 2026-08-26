import type { FastifyPluginCallbackTypebox } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox"
import { ErrorResponseSchema } from "../../shared/http/schemas.js"
import {
  AuthTokensSchema,
  LoginBodySchema,
  PublicUserSchema,
  RefreshBodySchema,
  VerifyPasswordBodySchema,
} from "./schemas.js"

function userAgent(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(", ")
  return value ?? null
}

export const authRoutes: FastifyPluginCallbackTypebox = (app, _options, done) => {
  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["Authentication"],
        body: LoginBodySchema,
        response: {
          200: AuthTokensSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.authService.login(request.body, {
      ipAddress: request.ip,
      userAgent: userAgent(request.headers["user-agent"]),
      requestId: request.correlationId,
    }),
  )

  app.post(
    "/refresh",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["Authentication"],
        body: RefreshBodySchema,
        response: {
          200: AuthTokensSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request) => app.authService.refresh(request.body.refreshToken, {
      ipAddress: request.ip,
      userAgent: userAgent(request.headers["user-agent"]),
      requestId: request.correlationId,
    }),
  )

  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Authentication"],
        security: [{ bearerAuth: [] }],
        response: {
          200: PublicUserSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    (request) => {
      const user = request.auth
      if (!user) throw new Error("Authentication hook did not set request.auth")

      return {
        id: user.id,
        tenantId: user.tenantId,
        name: user.name,
        email: user.email,
        role: user.role,
        ...(user.jobRole ? { jobRole: user.jobRole } : {}),
        ...(user.permissions ? { permissions: user.permissions } : {}),
      }
    },
  )

  app.post(
    "/verify-password",
    {
      preHandler: app.authenticate,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["Authentication"],
        security: [{ bearerAuth: [] }],
        body: VerifyPasswordBodySchema,
        response: {
          204: Type.Null(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.auth
      if (!user) throw new Error("Authentication hook did not set request.auth")
      await app.authService.verifyCurrentPassword(user, request.body.password)
      return reply.status(204).send(null)
    },
  )

  app.post(
    "/logout",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Authentication"],
        security: [{ bearerAuth: [] }],
        response: {
          204: Type.Null(),
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.auth
      if (!user) throw new Error("Authentication hook did not set request.auth")

      await app.authService.logout(user, request.correlationId)
      return reply.status(204).send(null)
    },
  )

  done()
}
