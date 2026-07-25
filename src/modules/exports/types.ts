import type {
  ExportSource,
  JobStatus,
  PaymentMethod,
  SaleStatus,
} from "../../database/types.js"

interface BaseExportInput {
  from?: string
  to?: string
}

export interface SalesHistoryExportInput extends BaseExportInput {
  source: "sales_history"
  status?: SaleStatus
  paymentMethod?: PaymentMethod
  customerId?: string
  operatorId?: string
  search?: string
}

export interface SalesKpisExportInput extends BaseExportInput {
  source: "sales_kpis"
}

export interface AuditEventsExportInput extends BaseExportInput {
  source: "audit_events"
  action?: string
  entityType?: string
  entityId?: string
  actorId?: string
  auditSource?: "api" | "worker" | "migration" | "system"
}

export type CreateExportInput =
  | SalesHistoryExportInput
  | SalesKpisExportInput
  | AuditEventsExportInput

export interface ExportJob {
  id: string
  source: ExportSource
  status: JobStatus
  requestedBy: string
  processedCount: number
  totalCount: number | null
  attempts: number
  errorCode: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  downloadReady: boolean
  filename: string | null
  expiresAt: string | null
}

export interface ExportArtifact {
  filename: string
  contentType: "text/csv; charset=utf-8"
  content: string
  sha256: string
}
