import type { ColumnType, Generated } from "kysely"

type Timestamp = ColumnType<Date, Date | string, Date | string>
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>
type JsonValue = ColumnType<unknown, unknown, unknown>

export type UserRole = "admin" | "funcionario"
export type ProductType = "raw_material" | "finished_product" | "packaging" | "service"
export type StockMovementType =
  | "receipt"
  | "sale"
  | "sale_reversal"
  | "return"
  | "reservation"
  | "reservation_release"
  | "positive_adjustment"
  | "negative_adjustment"
  | "stock_count_adjustment"

export interface TenantTable {
  id: Generated<string>
  slug: string
  name: string
  status: "active" | "suspended" | "archived"
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface TenantSettingsTable {
  tenant_id: string
  timezone: string
  currency: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
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
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
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
  created_at: GeneratedTimestamp
  last_used_at: NullableTimestamp
  revoked_at: NullableTimestamp
  revoke_reason: string | null
  replaced_by_session_id: string | null
}

export interface AuditEventTable {
  id: Generated<string>
  tenant_id: string
  occurred_at: GeneratedTimestamp
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
  available_at: GeneratedTimestamp
  created_at: GeneratedTimestamp
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
  created_at: GeneratedTimestamp
  expires_at: Timestamp
}

export interface CategoryTable {
  id: Generated<string>
  tenant_id: string
  parent_id: string | null
  name: string
  active: boolean
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface UnitTable {
  id: Generated<string>
  tenant_id: string
  name: string
  abbreviation: string
  allows_fractional: boolean
  quantity_scale: number
  active: boolean
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface ProductTable {
  id: Generated<string>
  tenant_id: string
  category_id: string
  unit_id: string
  sku: string | null
  barcode: string | null
  type: ProductType
  name: string
  description: string
  active: boolean
  minimum_stock: ColumnType<string, number | string, number | string>
  current_price_cents: number
  current_cost_cents: number | null
  cost_source: "manual" | "receipt" | "moving_average" | "estimated" | null
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface ProductPriceHistoryTable {
  id: Generated<string>
  tenant_id: string
  product_id: string
  old_price_cents: number | null
  new_price_cents: number
  actor_id: string
  reason: string
  effective_at: GeneratedTimestamp
}

export interface ProductCostHistoryTable {
  id: Generated<string>
  tenant_id: string
  product_id: string
  old_cost_cents: number | null
  new_cost_cents: number | null
  source: "manual" | "receipt" | "moving_average" | "estimated" | null
  actor_id: string
  reason: string
  effective_at: GeneratedTimestamp
}

export interface InventoryBalanceTable {
  tenant_id: string
  product_id: string
  on_hand: ColumnType<string, number | string, number | string>
  reserved: ColumnType<string, number | string, number | string>
  average_unit_cost_cents: ColumnType<
    string | null,
    number | string | null,
    number | string | null
  >
  version: Generated<number>
  updated_at: GeneratedTimestamp
}

export interface StockMovementTable {
  id: Generated<string>
  tenant_id: string
  product_id: string
  movement_type: StockMovementType
  quantity: ColumnType<string, number | string, never>
  resulting_on_hand: ColumnType<string, number | string, never>
  resulting_reserved: ColumnType<string, number | string, never>
  unit_cost_snapshot_cents: ColumnType<
    string | null,
    number | string | null,
    never
  >
  source_type: string
  source_id: string | null
  source_reference: string | null
  reason: string
  actor_user_id: string
  occurred_at: GeneratedTimestamp
  reversal_of_id: string | null
  created_at: GeneratedTimestamp
}

export interface Database {
  tenants: TenantTable
  tenant_settings: TenantSettingsTable
  users: UserTable
  auth_sessions: AuthSessionTable
  audit_events: AuditEventTable
  outbox_events: OutboxEventTable
  idempotency_records: IdempotencyRecordTable
  categories: CategoryTable
  units: UnitTable
  products: ProductTable
  product_price_history: ProductPriceHistoryTable
  product_cost_history: ProductCostHistoryTable
  inventory_balances: InventoryBalanceTable
  stock_movements: StockMovementTable
}
