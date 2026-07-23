import type { ProductType } from "../../database/types.js"

export interface Category {
  id: string
  name: string
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface Unit {
  id: string
  name: string
  abbreviation: string
  allowsFractional: boolean
  quantityScale: number
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export type CostSource = "manual" | "receipt" | "moving_average" | "estimated"

export interface Product {
  id: string
  sku: string | null
  barcode: string | null
  type: ProductType
  name: string
  description: string
  active: boolean
  minimumStock: number
  priceCents: number
  costCents: number | null
  costSource: CostSource | null
  category: {
    id: string
    name: string
  }
  unit: {
    id: string
    name: string
    abbreviation: string
    allowsFractional: boolean
    quantityScale: number
  }
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProductList {
  data: Product[]
  page: number
  pageSize: number
  total: number
}

export interface PriceHistoryEntry {
  id: string
  oldPriceCents: number | null
  newPriceCents: number
  reason: string
  actorId: string
  effectiveAt: string
}

export interface CostHistoryEntry {
  id: string
  oldCostCents: number | null
  newCostCents: number | null
  source: CostSource | null
  reason: string
  actorId: string
  effectiveAt: string
}

export interface ProductFilters {
  page: number
  pageSize: number
  search?: string
  categoryId?: string
  type?: ProductType
  active?: boolean
}

export interface CreateProductInput {
  sku?: string | null
  barcode?: string | null
  type: ProductType
  name: string
  description?: string
  active?: boolean
  minimumStock?: number
  priceCents: number
  costCents?: number | null
  costSource?: CostSource | null
  categoryId: string
  unitId: string
}

export interface UpdateProductInput {
  version: number
  sku?: string | null
  barcode?: string | null
  type?: ProductType
  name?: string
  description?: string
  active?: boolean
  minimumStock?: number
  priceCents?: number
  costCents?: number | null
  costSource?: CostSource | null
  categoryId?: string
  unitId?: string
  changeReason?: string
}
