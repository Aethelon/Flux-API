import type { PaymentMethod, SaleStatus } from "../../database/types.js"

export interface HistoryCursor {
  completedAt: string
  id: string
}

export interface SaleHistoryFilters {
  limit: number
  cursor?: HistoryCursor
  from?: Date
  to?: Date
  status?: SaleStatus
  customerId?: string
  operatorId?: string
  paymentMethod?: PaymentMethod
  search?: string
}

export interface SaleHistoryRecord {
  id: string
  businessNumber: number
  status: SaleStatus
  businessDate: string
  completedAt: string
  cancelledAt: string | null
  customer: { id: string; name: string } | null
  operator: { id: string; name: string }
  itemCount: number
  itemNames: string[]
  paymentMethods: PaymentMethod[]
  hasReturns: boolean
  financial?: {
    grossAmountCents: number
    discountAmountCents: number
    returnedAmountCents: number
    netRevenueCents: number
    cogsCents: number | null
    grossProfitCents: number | null
    grossMarginRate: number | null
    costComplete: boolean
  }
}

export interface SaleHistoryPage {
  data: SaleHistoryRecord[]
  nextCursor: string | null
}

export interface ReportContext {
  timezone: string
  currency: string
  from: Date
  to: Date
  generatedAt: Date
}

export interface HistoryKpis {
  calculationVersion: "history-kpi-v1"
  dateRange: {
    from: string
    to: string
  }
  timezone: string
  currency: string
  dataFreshnessAt: string
  completeness: {
    transactionsComplete: boolean
    costsComplete: boolean
    costCoverageRate: number
  }
  saleCountPolicy: "all_non_cancelled_completed_sales"
  grossRevenueCents: number
  discountAmountCents: number
  returnedAmountCents: number
  netRevenueCents: number
  completedSaleCount: number
  averageTicketCents: number | null
  unitsSold: number
  cogsCents: number | null
  grossProfitCents: number | null
  grossMarginRate: number | null
  paymentMethods: Array<{
    method: PaymentMethod
    netReceivedCents: number
  }>
}

export interface HistoryKpiInput {
  from?: Date
  to?: Date
}
