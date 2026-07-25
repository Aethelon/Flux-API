import type { PaymentMethod, ProductType, SaleStatus } from "../../database/types.js"

export interface SaleItem {
  id: string
  productId: string | null
  serviceOrderId: string | null
  productName: string
  productType: ProductType
  unitAbbreviation: string
  quantity: number
  unitPriceCents: number
  grossAmountCents: number
  allocatedDiscountCents: number
  netAmountCents: number
  unitCostSnapshotCents: number | null
  returnedQuantity: number
  returnedNetAmountCents: number
}

export interface SalePayment {
  id: string
  method: PaymentMethod
  amountCents: number
  effectiveAmountCents: number
  installments: number | null
  status: "completed" | "reversed" | "partially_refunded" | "refunded"
  externalReference: string | null
}

export interface SaleReturnItem {
  id: string
  saleItemId: string
  quantity: number
  amountCents: number
  restock: boolean
  unitCostSnapshotCents: number | null
  stockMovementId: string | null
}

export interface SaleReturn {
  id: string
  businessNumber: number
  reason: string
  totalAmountCents: number
  operator: { id: string; name: string }
  cashSessionId: string
  completedAt: string
  items: SaleReturnItem[]
  refunds: Array<{
    method: PaymentMethod
    amountCents: number
    externalReference: string | null
  }>
}

export interface Sale {
  id: string
  businessNumber: number
  status: SaleStatus
  customer: { id: string; name: string } | null
  operator: { id: string; name: string }
  cashSessionId: string
  grossAmountCents: number
  discountAmountCents: number
  netAmountCents: number
  returnedAmountCents: number
  changeAmountCents: number
  businessDate: string
  completedAt: string
  cancelledAt: string | null
  cancellationReason: string | null
  version: number
  items: SaleItem[]
  payments: SalePayment[]
  returns: SaleReturn[]
}

export interface CreateSaleInput {
  customerId?: string | null
  discountAmountCents?: number
  changeAmountCents?: number
  items: Array<
    | { productId: string; quantity: number }
    | { serviceOrderId: string }
  >
  payments: Array<{
    method: PaymentMethod
    amountCents: number
    installments?: number
    externalReference?: string | null
  }>
}

export interface CreateReturnInput {
  reason: string
  items: Array<{
    saleItemId: string
    quantity: number
    restock: boolean
  }>
  refunds: Array<{
    method: PaymentMethod
    amountCents: number
    externalReference?: string | null
  }>
}
