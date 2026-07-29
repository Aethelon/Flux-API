import type { HistoryKpis } from "../history/types.js"

export type DashboardBucket = "day" | "week" | "month"
export type TopProductMetric = "units" | "net_revenue"

export interface DashboardInput {
  from?: Date
  to?: Date
  bucket: DashboardBucket
  topBy: TopProductMetric
  topLimit: number
}

export interface Dashboard {
  calculationVersion: "dashboard-v1"
  dateRange: HistoryKpis["dateRange"]
  timezone: string
  currency: string
  dataFreshnessAt: string
  completeness: HistoryKpis["completeness"] & {
    inventoryCostsComplete: boolean
  }
  sales: HistoryKpis
  revenueSeries: Array<{
    bucketStart: string
    completedSaleCount: number
    grossRevenueCents: number
    discountAmountCents: number
    returnedAmountCents: number
    netRevenueCents: number
  }>
  serviceOrderSeries: Array<{
    bucketStart: string
    createdCount: number
    completedCount: number
  }>
  topProducts: {
    rankedBy: TopProductMetric
    data: Array<{
      productId: string
      name: string
      barcode: string | null
      type: "raw_material" | "finished_product" | "packaging" | "service"
      unitsSold: number
      netRevenueCents: number
    }>
  }
  inventorySeries: Array<{
    bucketStart: string
    soldOutCount: number
    lowStockCount: number
  }>
  inventory: {
    activeProductCount: number
    soldOutCount: number
    lowStockCount: number
    inventoryValueCents: number | null
    unitTurnover: number | null
    coverageDays: number | null
    stockoutRate: number | null
  }
  customers: {
    activeCustomerCount: number
    repeatCustomerCount: number
    purchaseFrequency: number | null
    repeatCustomerRate: number | null
  }
  serviceOrders: {
    createdCount: number
    completedCount: number
    openCount: number
    overdueOpenCount: number
    completionRate: number | null
    averageCycleTimeHours: number | null
    onTimeRate: number | null
  }
  cash: {
    openedSessionCount: number
    closedSessionCount: number
    closingDifferenceCents: number
  }
}
