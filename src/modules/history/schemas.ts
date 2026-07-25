import { Type } from "@sinclair/typebox"

const PaymentMethodSchema = Type.Union([
  Type.Literal("cash"),
  Type.Literal("credit"),
  Type.Literal("debit"),
  Type.Literal("pix"),
])

const SaleStatusSchema = Type.Union([
  Type.Literal("completed"),
  Type.Literal("partially_returned"),
  Type.Literal("returned"),
  Type.Literal("cancelled"),
])

export const HistorySalesQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
  status: Type.Optional(SaleStatusSchema),
  customerId: Type.Optional(Type.String({ format: "uuid" })),
  operatorId: Type.Optional(Type.String({ format: "uuid" })),
  paymentMethod: Type.Optional(PaymentMethodSchema),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false })

const FinancialSchema = Type.Object({
  grossAmountCents: Type.Integer({ minimum: 0 }),
  discountAmountCents: Type.Integer({ minimum: 0 }),
  returnedAmountCents: Type.Integer({ minimum: 0 }),
  netRevenueCents: Type.Integer({ minimum: 0 }),
  cogsCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  grossProfitCents: Type.Union([Type.Integer(), Type.Null()]),
  grossMarginRate: Type.Union([Type.Number(), Type.Null()]),
  costComplete: Type.Boolean(),
})

export const SaleHistoryRecordSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  businessNumber: Type.Integer({ minimum: 1 }),
  status: SaleStatusSchema,
  businessDate: Type.String({ format: "date" }),
  completedAt: Type.String({ format: "date-time" }),
  cancelledAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  customer: Type.Union([
    Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.String(),
    }),
    Type.Null(),
  ]),
  operator: Type.Object({
    id: Type.String({ format: "uuid" }),
    name: Type.String(),
  }),
  itemCount: Type.Integer({ minimum: 1 }),
  itemNames: Type.Array(Type.String()),
  paymentMethods: Type.Array(PaymentMethodSchema),
  hasReturns: Type.Boolean(),
  financial: Type.Optional(FinancialSchema),
})

export const SaleHistoryPageSchema = Type.Object({
  data: Type.Array(SaleHistoryRecordSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

export const HistoryKpisQuerySchema = Type.Object({
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
}, { additionalProperties: false })

export const HistoryKpisSchema = Type.Object({
  calculationVersion: Type.Literal("history-kpi-v1"),
  dateRange: Type.Object({
    from: Type.String({ format: "date-time" }),
    to: Type.String({ format: "date-time" }),
  }),
  timezone: Type.String(),
  currency: Type.String(),
  dataFreshnessAt: Type.String({ format: "date-time" }),
  completeness: Type.Object({
    transactionsComplete: Type.Boolean(),
    costsComplete: Type.Boolean(),
    costCoverageRate: Type.Number({ minimum: 0, maximum: 1 }),
  }),
  saleCountPolicy: Type.Literal("all_non_cancelled_completed_sales"),
  grossRevenueCents: Type.Integer({ minimum: 0 }),
  discountAmountCents: Type.Integer({ minimum: 0 }),
  returnedAmountCents: Type.Integer({ minimum: 0 }),
  netRevenueCents: Type.Integer(),
  completedSaleCount: Type.Integer({ minimum: 0 }),
  averageTicketCents: Type.Union([Type.Integer(), Type.Null()]),
  unitsSold: Type.Number(),
  cogsCents: Type.Union([Type.Integer(), Type.Null()]),
  grossProfitCents: Type.Union([Type.Integer(), Type.Null()]),
  grossMarginRate: Type.Union([Type.Number(), Type.Null()]),
  paymentMethods: Type.Array(Type.Object({
    method: PaymentMethodSchema,
    netReceivedCents: Type.Integer(),
  })),
})
