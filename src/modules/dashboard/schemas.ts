import { Type } from "@sinclair/typebox"
import { HistoryKpisSchema } from "../history/schemas.js"

export const DashboardQuerySchema = Type.Object({
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
  bucket: Type.Optional(Type.Union([
    Type.Literal("day"),
    Type.Literal("week"),
    Type.Literal("month"),
  ], { default: "day" })),
  topBy: Type.Optional(Type.Union([
    Type.Literal("units"),
    Type.Literal("net_revenue"),
  ], { default: "net_revenue" })),
  topLimit: Type.Optional(Type.String({ pattern: "^(?:[1-9]|1[0-9]|20)$" })),
}, { additionalProperties: false })

export const DashboardSchema = Type.Object({
  calculationVersion: Type.Literal("dashboard-v1"),
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
    inventoryCostsComplete: Type.Boolean(),
  }),
  sales: HistoryKpisSchema,
  revenueSeries: Type.Array(Type.Object({
    bucketStart: Type.String({ format: "date" }),
    completedSaleCount: Type.Integer({ minimum: 0 }),
    grossRevenueCents: Type.Integer({ minimum: 0 }),
    discountAmountCents: Type.Integer({ minimum: 0 }),
    returnedAmountCents: Type.Integer({ minimum: 0 }),
    netRevenueCents: Type.Integer(),
  })),
  serviceOrderSeries: Type.Array(Type.Object({
    bucketStart: Type.String({ format: "date" }),
    createdCount: Type.Integer({ minimum: 0 }),
    completedCount: Type.Integer({ minimum: 0 }),
  })),
  topProducts: Type.Object({
    rankedBy: Type.Union([Type.Literal("units"), Type.Literal("net_revenue")]),
    data: Type.Array(Type.Object({
      productId: Type.String({ format: "uuid" }),
      name: Type.String(),
      barcode: Type.Union([Type.String(), Type.Null()]),
      type: Type.Union([
        Type.Literal("raw_material"),
        Type.Literal("finished_product"),
        Type.Literal("packaging"),
        Type.Literal("service"),
      ]),
      unitsSold: Type.Number(),
      netRevenueCents: Type.Integer(),
    })),
  }),
  inventorySeries: Type.Array(Type.Object({
    bucketStart: Type.String({ format: "date" }),
    soldOutCount: Type.Integer({ minimum: 0 }),
    lowStockCount: Type.Integer({ minimum: 0 }),
  })),
  inventory: Type.Object({
    activeProductCount: Type.Integer({ minimum: 0 }),
    soldOutCount: Type.Integer({ minimum: 0 }),
    lowStockCount: Type.Integer({ minimum: 0 }),
    inventoryValueCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    unitTurnover: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    coverageDays: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    stockoutRate: Type.Union([
      Type.Number({ minimum: 0, maximum: 1 }),
      Type.Null(),
    ]),
  }),
  customers: Type.Object({
    activeCustomerCount: Type.Integer({ minimum: 0 }),
    repeatCustomerCount: Type.Integer({ minimum: 0 }),
    purchaseFrequency: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    repeatCustomerRate: Type.Union([
      Type.Number({ minimum: 0, maximum: 1 }),
      Type.Null(),
    ]),
  }),
  serviceOrders: Type.Object({
    createdCount: Type.Integer({ minimum: 0 }),
    completedCount: Type.Integer({ minimum: 0 }),
    openCount: Type.Integer({ minimum: 0 }),
    overdueOpenCount: Type.Integer({ minimum: 0 }),
    completionRate: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    averageCycleTimeHours: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    onTimeRate: Type.Union([
      Type.Number({ minimum: 0, maximum: 1 }),
      Type.Null(),
    ]),
  }),
  cash: Type.Object({
    openedSessionCount: Type.Integer({ minimum: 0 }),
    closedSessionCount: Type.Integer({ minimum: 0 }),
    closingDifferenceCents: Type.Integer(),
  }),
})
