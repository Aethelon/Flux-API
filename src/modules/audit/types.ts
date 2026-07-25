export interface AuditCursor {
  occurredAt: string
  id: string
}

export interface AuditFilters {
  limit: number
  cursor?: AuditCursor
  from?: Date
  to?: Date
  action?: string
  entityType?: string
  entityId?: string
  actorId?: string
  source?: "api" | "worker" | "migration" | "system"
}

export interface AuditEvent {
  id: string
  occurredAt: string
  actor: {
    type: "user" | "system" | "job"
    id: string | null
    name: string | null
  }
  action: string
  entityType: string
  entityId: string
  requestId: string | null
  correlationId: string | null
  source: "api" | "worker" | "migration" | "system"
  reason: string | null
  before: unknown
  after: unknown
  ipAddress: string | null
  userAgent: string | null
}

export interface AuditPage {
  data: AuditEvent[]
  nextCursor: string | null
}
