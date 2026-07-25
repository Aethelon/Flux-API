import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import { redactAuditPayload } from "./redaction.js"
import type { AuditEvent, AuditFilters } from "./types.js"

interface AuditRow {
  id: string
  occurred_at: Date
  actor_type: "user" | "system" | "job"
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string
  request_id: string | null
  correlation_id: string | null
  source: "api" | "worker" | "migration" | "system"
  reason: string | null
  before_json: unknown
  after_json: unknown
  ip_address: string | null
  user_agent: string | null
}

export interface AuditRepository {
  list(
    tenantId: string,
    filters: AuditFilters,
  ): Promise<{ data: AuditEvent[]; hasMore: boolean }>
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actor: {
      type: row.actor_type,
      id: row.actor_id,
      name: row.actor_name,
    },
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    source: row.source,
    reason: row.reason,
    before: redactAuditPayload(row.before_json),
    after: redactAuditPayload(row.after_json),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }
}

export class KyselyAuditRepository implements AuditRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async list(
    tenantId: string,
    filters: AuditFilters,
  ): Promise<{ data: AuditEvent[]; hasMore: boolean }> {
    let query = this.database.selectFrom("audit_events as event")
      .leftJoin("users as actor", (join) => join
        .onRef("actor.id", "=", "event.actor_id")
        .onRef("actor.tenant_id", "=", "event.tenant_id"))
      .select([
        "event.id",
        "event.occurred_at",
        "event.actor_type",
        "event.actor_id",
        "actor.name as actor_name",
        "event.action",
        "event.entity_type",
        "event.entity_id",
        "event.request_id",
        "event.correlation_id",
        "event.source",
        "event.reason",
        "event.before_json",
        "event.after_json",
        sql<string | null>`event.ip_address::text`.as("ip_address"),
        "event.user_agent",
      ])
      .where("event.tenant_id", "=", tenantId)

    if (filters.from) query = query.where("event.occurred_at", ">=", filters.from)
    if (filters.to) query = query.where("event.occurred_at", "<", filters.to)
    if (filters.action) query = query.where("event.action", "=", filters.action)
    if (filters.entityType) {
      query = query.where("event.entity_type", "=", filters.entityType)
    }
    if (filters.entityId) query = query.where("event.entity_id", "=", filters.entityId)
    if (filters.actorId) query = query.where("event.actor_id", "=", filters.actorId)
    if (filters.source) query = query.where("event.source", "=", filters.source)
    if (filters.cursor) {
      query = query.where(sql<boolean>`
        (event.occurred_at, event.id)
        < (${new Date(filters.cursor.occurredAt)}, ${filters.cursor.id}::uuid)
      `)
    }

    const rows = await query.orderBy("event.occurred_at", "desc")
      .orderBy("event.id", "desc")
      .limit(filters.limit + 1)
      .execute() as AuditRow[]
    return {
      data: rows.slice(0, filters.limit).map(mapAudit),
      hasMore: rows.length > filters.limit,
    }
  }
}
