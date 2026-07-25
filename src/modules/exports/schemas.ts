import { Type } from "@sinclair/typebox"

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

const DateRangeProperties = {
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
}

export const CreateExportBodySchema = Type.Union([
  Type.Object({
    source: Type.Literal("sales_history"),
    ...DateRangeProperties,
    status: Type.Optional(Type.Union([
      Type.Literal("completed"),
      Type.Literal("partially_returned"),
      Type.Literal("returned"),
      Type.Literal("cancelled"),
    ])),
    paymentMethod: Type.Optional(Type.Union([
      Type.Literal("cash"),
      Type.Literal("credit"),
      Type.Literal("debit"),
      Type.Literal("pix"),
    ])),
    customerId: Type.Optional(Type.String({ format: "uuid" })),
    operatorId: Type.Optional(Type.String({ format: "uuid" })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  }, { additionalProperties: false }),
  Type.Object({
    source: Type.Literal("sales_kpis"),
    ...DateRangeProperties,
  }, { additionalProperties: false }),
  Type.Object({
    source: Type.Literal("audit_events"),
    ...DateRangeProperties,
    action: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    entityType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    entityId: Type.Optional(Type.String({ format: "uuid" })),
    actorId: Type.Optional(Type.String({ format: "uuid" })),
    auditSource: Type.Optional(Type.Union([
      Type.Literal("api"),
      Type.Literal("worker"),
      Type.Literal("migration"),
      Type.Literal("system"),
    ])),
  }, { additionalProperties: false }),
])

export const ExportJobSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  source: Type.Union([
    Type.Literal("sales_history"),
    Type.Literal("sales_kpis"),
    Type.Literal("audit_events"),
  ]),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("processing"),
    Type.Literal("completed"),
    Type.Literal("failed"),
  ]),
  requestedBy: Type.String({ format: "uuid" }),
  processedCount: Type.Integer({ minimum: 0 }),
  totalCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  attempts: Type.Integer({ minimum: 0 }),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  finishedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  downloadReady: Type.Boolean(),
  filename: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
})
