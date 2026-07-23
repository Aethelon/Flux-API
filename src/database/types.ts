import type { ColumnType, Generated } from "kysely"

type Timestamp = ColumnType<Date, Date | string, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>
type JsonValue = ColumnType<unknown, unknown, unknown>

export type UserRole = "admin" | "funcionario"

export interface TenantTable {
  id: Generated<string>
  slug: string
  name: string
  status: "active" | "suspended" | "archived"
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
  archived_at: NullableTimestamp
}

export interface TenantSettingsTable {
  tenant_id: string
  timezone: string
  currency: string
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface UserTable {
  id: Generated<string>
  tenant_id: string
  name: string
  email: string
  phone: string | null
  password_hash: string
  role: UserRole
  status: "active" | "inactive"
  version: Generated<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
  archived_at: NullableTimestamp
}

export interface AuthSessionTable {
  id: Generated<string>
  tenant_id: string
  user_id: string
  family_id: string
  refresh_token_hash: string
  user_agent: string | null
  ip_address: string | null
  expires_at: Timestamp
  created_at: Generated<Timestamp>
  last_used_at: NullableTimestamp
  revoked_at: NullableTimestamp
  revoke_reason: string | null
  replaced_by_session_id: string | null
}

export interface AuditEventTable {
  id: Generated<string>
  tenant_id: string
  occurred_at: Generated<Timestamp>
  actor_type: "user" | "system" | "job"
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string
  request_id: string | null
  correlation_id: string | null
  source: "api" | "worker" | "migration" | "system"
  reason: string | null
  before_json: JsonValue | null
  after_json: JsonValue | null
  ip_address: string | null
  user_agent: string | null
}

export interface OutboxEventTable {
  id: Generated<string>
  tenant_id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: JsonValue
  status: "pending" | "processing" | "completed" | "failed"
  attempts: Generated<number>
  available_at: Generated<Timestamp>
  created_at: Generated<Timestamp>
  processed_at: NullableTimestamp
  last_error: string | null
}

export interface IdempotencyRecordTable {
  id: Generated<string>
  tenant_id: string
  user_id: string
  route: string
  idempotency_key: string
  request_hash: string
  response_status: number | null
  response_body: JsonValue | null
  created_at: Generated<Timestamp>
  expires_at: Timestamp
}

export interface Database {
  tenants: TenantTable
  tenant_settings: TenantSettingsTable
  users: UserTable
  auth_sessions: AuthSessionTable
  audit_events: AuditEventTable
  outbox_events: OutboxEventTable
  idempotency_records: IdempotencyRecordTable
}
