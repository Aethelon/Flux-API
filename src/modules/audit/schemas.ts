import { Type } from "@sinclair/typebox"

export const AuditQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
  action: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  entityType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  entityId: Type.Optional(Type.String({ format: "uuid" })),
  actorId: Type.Optional(Type.String({ format: "uuid" })),
  source: Type.Optional(Type.Union([
    Type.Literal("api"),
    Type.Literal("worker"),
    Type.Literal("migration"),
    Type.Literal("system"),
  ])),
}, { additionalProperties: false })

export const AuditPageSchema = Type.Object({
  data: Type.Array(Type.Object({
    id: Type.String({ format: "uuid" }),
    occurredAt: Type.String({ format: "date-time" }),
    actor: Type.Object({
      type: Type.Union([
        Type.Literal("user"),
        Type.Literal("system"),
        Type.Literal("job"),
      ]),
      id: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
      name: Type.Union([Type.String(), Type.Null()]),
    }),
    action: Type.String(),
    entityType: Type.String(),
    entityId: Type.String({ format: "uuid" }),
    requestId: Type.Union([Type.String(), Type.Null()]),
    correlationId: Type.Union([Type.String(), Type.Null()]),
    source: Type.Union([
      Type.Literal("api"),
      Type.Literal("worker"),
      Type.Literal("migration"),
      Type.Literal("system"),
    ]),
    reason: Type.Union([Type.String(), Type.Null()]),
    before: Type.Unknown(),
    after: Type.Unknown(),
    ipAddress: Type.Union([Type.String(), Type.Null()]),
    userAgent: Type.Union([Type.String(), Type.Null()]),
  })),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
