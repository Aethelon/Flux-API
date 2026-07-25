import { Type } from "@sinclair/typebox"

export const IdParamsSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
})

export const IdempotencyHeadersSchema = Type.Object({
  "idempotency-key": Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: true })

export const CreateForecastRunBodySchema = Type.Object({
  productId: Type.Optional(Type.String({ format: "uuid" })),
  includeRevenue: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const ForecastQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
  targetType: Type.Optional(Type.Union([
    Type.Literal("product_demand"),
    Type.Literal("monthly_revenue"),
  ])),
  productId: Type.Optional(Type.String({ format: "uuid" })),
  publishedOnly: Type.Optional(Type.Union([
    Type.Literal("true"),
    Type.Literal("false"),
  ])),
}, { additionalProperties: false })

const ConfidenceLabelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("unavailable"),
])

const ForecastPointSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  bucketStart: Type.String({ format: "date" }),
  horizon: Type.Integer({ minimum: 1 }),
  pointEstimate: Type.Number(),
  lowerLimit: Type.Union([Type.Number(), Type.Null()]),
  upperLimit: Type.Union([Type.Number(), Type.Null()]),
  seasonalFactor: Type.Union([Type.Number(), Type.Null()]),
  operationalValue: Type.Number({ minimum: 0 }),
})

const ForecastRunSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  targetType: Type.Union([
    Type.Literal("product_demand"),
    Type.Literal("monthly_revenue"),
  ]),
  product: Type.Union([
    Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.String(),
    }),
    Type.Null(),
  ]),
  method: Type.Union([
    Type.Literal("ols_trend"),
    Type.Literal("seasonal_ols"),
    Type.Literal("naive_last_value"),
    Type.Literal("unavailable"),
  ]),
  calculationVersion: Type.String(),
  trainingFrom: Type.String({ format: "date-time" }),
  trainingTo: Type.String({ format: "date-time" }),
  bucketCount: Type.Integer({ minimum: 0 }),
  eligibleBucketCount: Type.Integer({ minimum: 0 }),
  dataQuality: Type.Unknown(),
  modelMetrics: Type.Unknown(),
  baselineMetrics: Type.Unknown(),
  confidenceScore: Type.Union([
    Type.Number({ minimum: 0, maximum: 100 }),
    Type.Null(),
  ]),
  confidenceLabel: ConfidenceLabelSchema,
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("insufficient_data"),
    Type.Literal("poor_data_quality"),
    Type.Literal("baseline_not_beaten"),
  ]),
  limitations: Type.Unknown(),
  sourceSnapshotIds: Type.Array(Type.String({ format: "uuid" })),
  createdAt: Type.String({ format: "date-time" }),
  published: Type.Boolean(),
  points: Type.Array(ForecastPointSchema),
})

export const ForecastPageSchema = Type.Object({
  data: Type.Array(ForecastRunSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

const RecommendationSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  runId: Type.String({ format: "uuid" }),
  calculationVersion: Type.String(),
  configuration: Type.Unknown(),
  type: Type.Union([
    Type.Literal("replenishment"),
    Type.Literal("promotion"),
    Type.Literal("overstock_review"),
  ]),
  product: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  evidenceMetrics: Type.Unknown(),
  proposedValue: Type.Unknown(),
  confidenceScore: Type.Union([
    Type.Number({ minimum: 0, maximum: 100 }),
    Type.Null(),
  ]),
  confidenceLabel: ConfidenceLabelSchema,
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

export const RecommendationQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-4][0-9]|50)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(Type.Union([
    Type.Literal("replenishment"),
    Type.Literal("promotion"),
    Type.Literal("overstock_review"),
  ])),
  state: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("accepted"),
    Type.Literal("rejected"),
  ])),
  productId: Type.Optional(Type.String({ format: "uuid" })),
}, { additionalProperties: false })

export const RecommendationPageSchema = Type.Object({
  data: Type.Array(RecommendationSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

export const ReviewRecommendationBodySchema = Type.Object({
  decision: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("rejected"),
  ]),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
}, { additionalProperties: false })

export const AnalyticsJobSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  runType: Type.Union([
    Type.Literal("forecasts"),
    Type.Literal("recommendations"),
  ]),
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

export { RecommendationSchema }
