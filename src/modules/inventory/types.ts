import type {
  ProductType,
  StockCountStatus,
  StockMovementType,
} from "../../database/types.js"

export type InventoryStatus = "inactive" | "sold_out" | "low_stock" | "available"
export type ManualMovementType = "receipt" | "positive_adjustment" | "negative_adjustment"

export interface InventoryBalance {
  product: {
    id: string
    sku: string | null
    barcode: string | null
    type: Exclude<ProductType, "service">
    name: string
    active: boolean
    minimumStock: number
    category: {
      id: string
      name: string
    }
    unit: {
      id: string
      name: string
      abbreviation: string
      quantityScale: number
    }
  }
  onHand: number
  reserved: number
  available: number
  averageUnitCostCents: number | null
  inventoryValueCents: number | null
  status: InventoryStatus
  version: number
  updatedAt: string
}

export interface InventoryBalanceList {
  data: InventoryBalance[]
  page: number
  pageSize: number
  total: number
}

export interface StockMovement {
  id: string
  product: {
    id: string
    name: string
    sku: string | null
    unitAbbreviation: string
  }
  type: StockMovementType
  quantity: number
  resultingOnHand: number
  resultingReserved: number
  unitCostSnapshotCents: number | null
  sourceType: string
  sourceId: string | null
  sourceReference: string | null
  reason: string
  actor: {
    id: string
    name: string
  }
  occurredAt: string
  reversalOfId: string | null
}

export interface StockMovementList {
  data: StockMovement[]
  nextCursor: string | null
}

export interface BalanceFilters {
  page: number
  pageSize: number
  search?: string
  status?: InventoryStatus
}

export interface MovementFilters {
  limit: number
  productId?: string
  type?: StockMovementType
  cursor?: {
    occurredAt: string
    id: string
  }
}

export interface MovementPage {
  data: StockMovement[]
  hasMore: boolean
}

export interface CreateManualMovementInput {
  productId: string
  type: ManualMovementType
  quantity: number
  unitCostCents?: number
  sourceReference?: string
  reason: string
}

export interface StockCountItem {
  id: string
  product: {
    id: string
    name: string
    sku: string | null
    unitAbbreviation: string
    quantityScale: number
  }
  expectedQuantity: number
  countedQuantity: number | null
  difference: number | null
  unitCostSnapshotCents: number | null
  movementId: string | null
}

export interface StockCount {
  id: string
  status: StockCountStatus
  reason: string
  startedBy: {
    id: string
    name: string
  }
  startedAt: string
  confirmedBy: {
    id: string
    name: string
  } | null
  confirmedAt: string | null
  cancelledBy: {
    id: string
    name: string
  } | null
  cancelledAt: string | null
  cancellationReason: string | null
  version: number
  items: StockCountItem[]
}

export interface StockCountList {
  data: Array<Omit<StockCount, "items"> & { itemCount: number }>
  page: number
  pageSize: number
  total: number
}

export interface StockCountFilters {
  page: number
  pageSize: number
  status?: StockCountStatus
}

export interface CreateStockCountInput {
  reason: string
  productIds: string[]
}

export interface ConfirmStockCountInput {
  version: number
  items: Array<{
    productId: string
    countedQuantity: number
    unitCostCents?: number
  }>
}

export interface CancelStockCountInput {
  version: number
  reason: string
}
