import type { ServiceOrderStatus } from "../../database/types.js"

export interface ServiceOrderColumn {
  id: string
  label: string
  semanticType: ServiceOrderStatus
  colorToken: string
  displayPosition: number
  protected: boolean
  version: number
}

export interface ServiceOrderTransition {
  id: string
  previousColumnId: string | null
  newColumnId: string
  previousStatus: ServiceOrderStatus | null
  newStatus: ServiceOrderStatus
  actor: { id: string; name: string }
  occurredAt: string
  reason: string
  metadata: unknown
}

export interface ServiceOrder {
  id: string
  businessNumber: number
  customer: { id: string; name: string }
  title: string
  description: string
  priority: "low" | "medium" | "high"
  dueAt: string | null
  estimatedValueCents: number
  finalSaleId: string | null
  column: ServiceOrderColumn
  status: ServiceOrderStatus
  responsible: { id: string; name: string } | null
  completedAt: string | null
  cancelledAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  history: ServiceOrderTransition[]
}

export interface CreateServiceOrderInput {
  customerId: string
  columnId?: string
  title: string
  description?: string
  priority: "low" | "medium" | "high"
  dueAt?: string | null
  estimatedValueCents: number
  responsibleUserId?: string | null
}

export interface UpdateServiceOrderInput {
  version: number
  customerId?: string
  title?: string
  description?: string
  priority?: "low" | "medium" | "high"
  dueAt?: string | null
  estimatedValueCents?: number
  responsibleUserId?: string | null
}
