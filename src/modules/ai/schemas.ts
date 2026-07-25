import { Type } from "@sinclair/typebox"

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

export const AiInsightQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
  state: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("accepted"),
    Type.Literal("rejected"),
  ])),
}, { additionalProperties: false })

export const AiJobSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  runType: Type.Literal("insights"),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("processing"),
    Type.Literal("completed"),
    Type.Literal("failed"),
  ]),
  processedCount: Type.Integer({ minimum: 0 }),
  totalCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  attempts: Type.Integer({ minimum: 0 }),
  errorCode: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  finishedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
})

export const AiInsightSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  runId: Type.String({ format: "uuid" }),
  runStatus: Type.Union([
    Type.Literal("pending"),
    Type.Literal("processing"),
    Type.Literal("completed"),
    Type.Literal("cached"),
    Type.Literal("rejected"),
    Type.Literal("failed"),
    Type.Literal("budget_exceeded"),
  ]),
  provider: Type.Union([
    Type.Literal("gemini"),
    Type.Literal("anthropic"),
  ]),
  modelId: Type.String(),
  promptVersion: Type.String(),
  schemaVersion: Type.String(),
  policyVersion: Type.String(),
  type: Type.Union([
    Type.Literal("summary"),
    Type.Literal("strength"),
    Type.Literal("risk"),
    Type.Literal("recommendation"),
  ]),
  text: Type.String(),
  severity: Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
    Type.Null(),
  ]),
  sourceMetricIds: Type.Array(Type.String({ format: "uuid" })),
  requiresHumanReview: Type.Boolean(),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("accepted"),
    Type.Literal("rejected"),
  ]),
  reviewer: Type.Union([
    Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.String(),
    }),
    Type.Null(),
  ]),
  reviewedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  reviewReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
})

export const AiInsightPageSchema = Type.Object({
  data: Type.Array(AiInsightSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  availability: Type.Union([
    Type.Literal("available"),
    Type.Literal("unavailable"),
  ]),
  latestRunStatus: Type.Union([
    Type.Literal("pending"),
    Type.Literal("processing"),
    Type.Literal("completed"),
    Type.Literal("cached"),
    Type.Literal("rejected"),
    Type.Literal("failed"),
    Type.Literal("budget_exceeded"),
    Type.Null(),
  ]),
})

export const ReviewAiInsightBodySchema = Type.Object({
  decision: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("rejected"),
  ]),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })
