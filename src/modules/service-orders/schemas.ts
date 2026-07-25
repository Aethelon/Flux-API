import { Type } from "@sinclair/typebox"

export const IdParamsSchema = Type.Object({ id: Type.String({ format: "uuid" }) })

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

const StatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
])

export const ColumnSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  label: Type.String(),
  semanticType: StatusSchema,
  colorToken: Type.String(),
  displayPosition: Type.Integer({ minimum: 0 }),
  protected: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
})

const HistorySchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  previousColumnId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  newColumnId: Type.String({ format: "uuid" }),
  previousStatus: Type.Union([StatusSchema, Type.Null()]),
  newStatus: StatusSchema,
  actor: Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
  occurredAt: Type.String({ format: "date-time" }),
  reason: Type.String(),
  metadata: Type.Unknown(),
})

export const ServiceOrderSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer({ minimum: 1 }),
  customer: Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
  title: Type.String(),
  description: Type.String(),
  priority: Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ]),
  dueAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  estimatedValueCents: Type.Integer({ minimum: 0 }),
  finalSaleId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  column: ColumnSchema,
  status: StatusSchema,
  responsible: Type.Union([
    Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String() }),
    Type.Null(),
  ]),
  completedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
  history: Type.Array(HistorySchema),
})

export const CreateColumnBodySchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 120 }),
  semanticType: Type.Union([Type.Literal("open"), Type.Literal("cancelled")]),
  colorToken: Type.String({ pattern: "^--color-[a-z0-9-]+$", maxLength: 80 }),
  displayPosition: Type.Integer({ minimum: 0, maximum: 1_000 }),
}, { additionalProperties: false })

export const UpdateColumnBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  colorToken: Type.Optional(Type.String({
    pattern: "^--color-[a-z0-9-]+$",
    maxLength: 80,
  })),
  displayPosition: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000 })),
}, { additionalProperties: false })

export const ArchiveBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

const PrioritySchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
])

export const CreateServiceOrderBodySchema = Type.Object({
  customerId: Type.String({ format: "uuid" }),
  columnId: Type.Optional(Type.String({ format: "uuid" })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 10_000 })),
  priority: PrioritySchema,
  dueAt: Type.Optional(Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ])),
  estimatedValueCents: Type.Integer({ minimum: 0 }),
  responsibleUserId: Type.Optional(Type.Union([
    Type.String({ format: "uuid" }),
    Type.Null(),
  ])),
}, { additionalProperties: false })

export const UpdateServiceOrderBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  customerId: Type.Optional(Type.String({ format: "uuid" })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 10_000 })),
  priority: Type.Optional(PrioritySchema),
  dueAt: Type.Optional(Type.Union([
    Type.String({ format: "date-time" }),
    Type.Null(),
  ])),
  estimatedValueCents: Type.Optional(Type.Integer({ minimum: 0 })),
  responsibleUserId: Type.Optional(Type.Union([
    Type.String({ format: "uuid" }),
    Type.Null(),
  ])),
}, { additionalProperties: false })

export const TransitionBodySchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  columnId: Type.String({ format: "uuid" }),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const ListQuerySchema = Type.Object({
  view: Type.Optional(Type.Union([Type.Literal("board"), Type.Literal("history")])),
})
