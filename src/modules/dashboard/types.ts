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
    grossRevenueCents: number
    discountAmountCents: number
    returnedAmountCents: number
    netRevenueCents: number
  }>
  topProducts: {
    rankedBy: TopProductMetric
    data: Array<{
      productId: string
      name: string
      unitsSold: number
      netRevenueCents: number
    }>
  }
  inventory: {
    activeProductCount: number
    soldOutCount: number
    lowStockCount: number
    inventoryValueCents: number | null
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
