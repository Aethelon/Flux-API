import { Type } from "@sinclair/typebox"

export const UserRoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("funcionario"),
])

export const PublicUserSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  tenantId: Type.String({ format: "uuid" }),
  name: Type.String(),
  email: Type.String({ format: "email" }),
  role: UserRoleSchema,
})

export const AuthTokensSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  accessTokenExpiresIn: Type.Integer(),
  user: PublicUserSchema,
})

export const LoginBodySchema = Type.Object({
  email: Type.String({ format: "email", maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
  tenantSlug: Type.Optional(
    Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-z0-9-]+$" }),
  ),
})

export const RefreshBodySchema = Type.Object({
  refreshToken: Type.String({ minLength: 64, maxLength: 256 }),
})
