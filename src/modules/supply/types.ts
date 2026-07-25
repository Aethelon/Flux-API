export interface Supplier {
  id: string
  legalName: string
  tradeName: string | null
  taxId: string | null
  email: string | null
  phone: string | null
  contactName: string | null
  notes: string
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProductSupplier {
  id: string
  supplierId: string
  product: {
    id: string
    name: string
    sku: string | null
    unitAbbreviation: string
    quantityScale: number
  }
  supplierSku: string | null
  active: boolean
  leadTimeDays: number
  minimumOrderQuantity: number
  packMultiple: number
  validFrom: string
  validUntil: string | null
}

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "partially_received"
  | "received"
  | "cancelled"

export interface PurchaseOrder {
  id: string
  businessNumber: number
  supplier: { id: string; name: string }
  status: PurchaseOrderStatus
  orderedAt: string | null
  expectedAt: string | null
  notes: string
  cancellationReason: string | null
  version: number
  createdAt: string
  items: Array<{
    id: string
    productId: string
    productName: string
    unitAbbreviation: string
    orderedQuantity: number
    receivedQuantity: number
    agreedUnitCostCents: number
    supplierSku: string | null
    packMultiple: number
    minimumOrderQuantity: number
  }>
}

export interface GoodsReceipt {
  id: string
  businessNumber: number
  purchaseOrderId: string
  status: "completed" | "reversed"
  supplierDocumentReference: string | null
  receivedBy: { id: string; name: string }
  receivedAt: string
  reversedBy: { id: string; name: string } | null
  reversedAt: string | null
  reversalReason: string | null
  items: Array<{
    id: string
    purchaseOrderItemId: string
    productId: string
    receivedQuantity: number
    acceptedUnitCostCents: number
    lotReference: string | null
    stockMovementId: string
  }>
}

export interface SupplyPage<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}
