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
export type StockCountStatus = "draft" | "confirmed" | "cancelled"

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
  forecast_horizon: Generated<number>
  forecast_training_buckets: Generated<number>
  forecast_minimum_buckets: Generated<number>
  forecast_preferred_buckets: Generated<number>
  forecast_seasonal_cycle: Generated<number>
  forecast_baseline_tolerance: Generated<string>
  forecast_baseline_policy: Generated<"naive" | "reject">
  forecast_confidence_coverage_weight: Generated<string>
  forecast_confidence_accuracy_weight: Generated<string>
  forecast_confidence_availability_weight: Generated<string>
  forecast_confidence_high_threshold: Generated<string>
  forecast_confidence_medium_threshold: Generated<string>
  stockout_exclusion_rate: Generated<string>
  service_level: Generated<string>
  review_period_days: Generated<number>
  demand_window_days: Generated<number>
  promotion_overstock_threshold: Generated<string>
  promotion_turnover_threshold: Generated<string>
  promotion_cap: Generated<string>
  promotion_coefficient: Generated<string>
  minimum_gross_margin: Generated<string>
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

export interface StockCountTable {
  id: Generated<string>
  tenant_id: string
  status: StockCountStatus
  reason: string
  started_by: string
  started_at: GeneratedTimestamp
  confirmed_by: string | null
  confirmed_at: NullableTimestamp
  cancelled_by: string | null
  cancelled_at: NullableTimestamp
  cancellation_reason: string | null
  version: Generated<number>
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface StockCountItemTable {
  id: Generated<string>
  tenant_id: string
  stock_count_id: string
  product_id: string
  expected_quantity: ColumnType<string, number | string, never>
  counted_quantity: ColumnType<string | null, number | string | null, number | string>
  difference: ColumnType<string | null, number | string | null, number | string>
  unit_cost_snapshot_cents: ColumnType<
    string | null,
    number | string | null,
    number | string | null
  >
  movement_id: string | null
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface StockoutIntervalTable {
  id: Generated<string>
  tenant_id: string
  product_id: string
  started_at: Timestamp
  ended_at: NullableTimestamp
  detected_reason: string
  source_movement_id: string | null
  ended_by_movement_id: string | null
  created_at: GeneratedTimestamp
}

export interface InventoryDailySnapshotTable {
  tenant_id: string
  product_id: string
  local_date: ColumnType<string, string, never>
  opening: ColumnType<string, number | string, never>
  received: ColumnType<string, number | string, number | string>
  sold: ColumnType<string, number | string, number | string>
  returned: ColumnType<string, number | string, number | string>
  adjusted: ColumnType<string, number | string, number | string>
  closing: ColumnType<string, number | string, number | string>
  reserved: ColumnType<string, number | string, number | string>
  in_stock_minutes: ColumnType<string, number | string, number | string>
  stockout_minutes: ColumnType<string, number | string, number | string>
  observed_minutes: ColumnType<string, number | string, number | string>
  last_observed_at: Timestamp
  complete: boolean
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface TenantSequenceTable {
  tenant_id: string
  sequence_name: string
  current_value: ColumnType<string, number | string, number | string>
  updated_at: GeneratedTimestamp
}

export interface CustomerTable {
  id: Generated<string>
  tenant_id: string
  name: string
  email: string | null
  phone: string | null
  notes: string
  status: "active" | "inactive"
  consent_at: NullableTimestamp
  anonymized_at: NullableTimestamp
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface SupplierTable {
  id: Generated<string>
  tenant_id: string
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  email: string | null
  phone: string | null
  contact_name: string | null
  notes: string
  active: boolean
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface ProductSupplierTable {
  id: Generated<string>
  tenant_id: string
  supplier_id: string
  product_id: string
  supplier_sku: string | null
  active: boolean
  lead_time_days: number
  minimum_order_quantity: ColumnType<string, number | string, never>
  pack_multiple: ColumnType<string, number | string, never>
  valid_from: GeneratedTimestamp
  valid_until: NullableTimestamp
  created_by: string
  created_at: GeneratedTimestamp
}

export interface PurchaseOrderTable {
  id: Generated<string>
  tenant_id: string
  business_number: ColumnType<string, number | string, never>
  supplier_id: string
  status: "draft" | "submitted" | "partially_received" | "received" | "cancelled"
  ordered_at: NullableTimestamp
  expected_at: NullableTimestamp
  created_by: string
  approved_by: string | null
  approved_at: NullableTimestamp
  cancellation_reason: string | null
  recommendation_id: string | null
  notes: string
  version: Generated<number>
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface PurchaseOrderItemTable {
  id: Generated<string>
  tenant_id: string
  purchase_order_id: string
  product_id: string
  product_name_snapshot: string
  unit_abbreviation_snapshot: string
  ordered_quantity: ColumnType<string, number | string, never>
  received_quantity: ColumnType<string, number | string, number | string>
  agreed_unit_cost_cents: ColumnType<string, number | string, never>
  supplier_sku_snapshot: string | null
  pack_multiple_snapshot: ColumnType<string, number | string, never>
  minimum_order_quantity_snapshot: ColumnType<string, number | string, never>
  created_at: GeneratedTimestamp
}

export interface GoodsReceiptTable {
  id: Generated<string>
  tenant_id: string
  business_number: ColumnType<string, number | string, never>
  purchase_order_id: string
  status: "completed" | "reversed"
  supplier_document_reference: string | null
  received_by: string
  received_at: GeneratedTimestamp
  reversed_by: string | null
  reversed_at: NullableTimestamp
  reversal_reason: string | null
  created_at: GeneratedTimestamp
}

export interface GoodsReceiptItemTable {
  id: Generated<string>
  tenant_id: string
  goods_receipt_id: string
  purchase_order_item_id: string
  product_id: string
  received_quantity: ColumnType<string, number | string, never>
  accepted_unit_cost_cents: ColumnType<string, number | string, never>
  lot_reference: string | null
  stock_movement_id: string
  created_at: GeneratedTimestamp
}

export type PaymentMethod = "cash" | "credit" | "debit" | "pix"

export interface CashRegisterTable {
  id: Generated<string>
  tenant_id: string
  code: string
  name: string
  active: boolean
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface CashRegisterAssignmentTable {
  id: Generated<string>
  tenant_id: string
  user_id: string
  cash_register_id: string
  valid_from: GeneratedTimestamp
  valid_until: NullableTimestamp
  assigned_by: string
  reason: string
  created_at: GeneratedTimestamp
}

export interface CashSessionTable {
  id: Generated<string>
  tenant_id: string
  cash_register_id: string
  opening_operator_id: string
  opened_at: GeneratedTimestamp
  opening_amount_cents: ColumnType<string, number | string, never>
  status: "open" | "closed"
  closing_operator_id: string | null
  closed_at: NullableTimestamp
  closing_note: string | null
  version: Generated<number>
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface CashMovementTable {
  id: Generated<string>
  tenant_id: string
  cash_session_id: string
  movement_type:
    | "opening"
    | "sale"
    | "sale_reversal"
    | "return"
    | "supply"
    | "withdrawal"
    | "closing_adjustment"
  payment_method: PaymentMethod
  amount_cents: ColumnType<string, number | string, never>
  source_type: string
  source_id: string | null
  actor_user_id: string
  reason: string
  occurred_at: GeneratedTimestamp
  reversal_of_id: string | null
  created_at: GeneratedTimestamp
}

export interface CashCloseCountTable {
  id: Generated<string>
  tenant_id: string
  cash_session_id: string
  payment_method: PaymentMethod
  expected_amount_cents: ColumnType<string, number | string, never>
  counted_amount_cents: ColumnType<string, number | string, never>
  difference_cents: ColumnType<string, number | string, never>
  actor_user_id: string
  counted_at: GeneratedTimestamp
}

export type SaleStatus = "completed" | "partially_returned" | "returned" | "cancelled"

export interface SaleTable {
  id: Generated<string>
  tenant_id: string
  business_number: ColumnType<string, number | string, never>
  status: SaleStatus
  customer_id: string | null
  customer_name_snapshot: string | null
  operator_id: string
  cash_session_id: string
  gross_amount_cents: ColumnType<string, number | string, never>
  discount_amount_cents: ColumnType<string, number | string, never>
  net_amount_cents: ColumnType<string, number | string, never>
  returned_amount_cents: ColumnType<string, number | string, number | string>
  change_amount_cents: ColumnType<string, number | string, never>
  business_date: ColumnType<string, string, never>
  completed_at: GeneratedTimestamp
  cancelled_by: string | null
  cancelled_at: NullableTimestamp
  cancellation_reason: string | null
  version: Generated<number>
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface SaleItemTable {
  id: Generated<string>
  tenant_id: string
  sale_id: string
  product_id: string | null
  product_name_snapshot: string
  product_type_snapshot: ProductType
  unit_abbreviation_snapshot: string
  quantity: ColumnType<string, number | string, never>
  unit_price_cents: number
  gross_amount_cents: ColumnType<string, number | string, never>
  allocated_discount_cents: ColumnType<string, number | string, never>
  net_amount_cents: ColumnType<string, number | string, never>
  unit_cost_snapshot_cents: ColumnType<
    string | null,
    number | string | null,
    never
  >
  returned_quantity: ColumnType<string, number | string, number | string>
  returned_net_amount_cents: ColumnType<string, number | string, number | string>
  service_order_id: string | null
  service_order_previous_column_id: string | null
  created_at: GeneratedTimestamp
}

export interface PaymentTable {
  id: Generated<string>
  tenant_id: string
  sale_id: string
  payment_method: PaymentMethod
  amount_cents: ColumnType<string, number | string, never>
  effective_amount_cents: ColumnType<string, number | string, never>
  installments: number | null
  status: "completed" | "reversed" | "partially_refunded" | "refunded"
  external_reference: string | null
  created_at: GeneratedTimestamp
}

export interface SaleReturnTable {
  id: Generated<string>
  tenant_id: string
  business_number: ColumnType<string, number | string, never>
  sale_id: string
  operator_id: string
  cash_session_id: string
  reason: string
  total_amount_cents: ColumnType<string, number | string, never>
  status: "completed"
  completed_at: GeneratedTimestamp
  created_at: GeneratedTimestamp
}

export interface SaleReturnItemTable {
  id: Generated<string>
  tenant_id: string
  return_id: string
  sale_item_id: string
  quantity: ColumnType<string, number | string, never>
  amount_cents: ColumnType<string, number | string, never>
  restock: boolean
  unit_cost_snapshot_cents: ColumnType<
    string | null,
    number | string | null,
    never
  >
  stock_movement_id: string | null
  created_at: GeneratedTimestamp
}

export interface SaleReturnRefundTable {
  id: Generated<string>
  tenant_id: string
  return_id: string
  payment_method: PaymentMethod
  amount_cents: ColumnType<string, number | string, never>
  external_reference: string | null
  created_at: GeneratedTimestamp
}

export type ServiceOrderStatus = "open" | "completed" | "cancelled"

export interface ServiceOrderColumnTable {
  id: Generated<string>
  tenant_id: string
  label: string
  semantic_type: ServiceOrderStatus
  color_token: string
  display_position: number
  protected: boolean
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface ServiceOrderTable {
  id: Generated<string>
  tenant_id: string
  business_number: ColumnType<string, number | string, never>
  customer_id: string
  customer_name_snapshot: string
  title: string
  description: string
  priority: "low" | "medium" | "high"
  due_at: NullableTimestamp
  estimated_value_cents: ColumnType<string, number | string, number | string>
  final_sale_id: string | null
  current_column_id: string
  current_status: ServiceOrderStatus
  responsible_user_id: string | null
  completed_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  version: Generated<number>
  created_by: string
  updated_by: string
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface ServiceOrderStatusHistoryTable {
  id: Generated<string>
  tenant_id: string
  service_order_id: string
  previous_column_id: string | null
  new_column_id: string
  previous_status: ServiceOrderStatus | null
  new_status: ServiceOrderStatus
  actor_user_id: string
  occurred_at: GeneratedTimestamp
  reason: string
  metadata: JsonValue | null
  created_at: GeneratedTimestamp
}

export type ExportSource = "sales_history" | "sales_kpis" | "audit_events"
export type JobStatus = "pending" | "processing" | "completed" | "failed"

export interface JobRunTable {
  id: Generated<string>
  tenant_id: string
  job_type: "export" | "analytics"
  status: JobStatus
  requested_by: string
  parameters: JsonValue
  cursor: JsonValue | null
  total_count: number | null
  processed_count: Generated<number>
  attempts: Generated<number>
  error_class: string | null
  error_message: string | null
  available_at: GeneratedTimestamp
  started_at: NullableTimestamp
  finished_at: NullableTimestamp
  created_at: GeneratedTimestamp
  updated_at: GeneratedTimestamp
}

export interface BusinessCalendarEventTable {
  id: Generated<string>
  tenant_id: string
  name: string
  recurring_key: string | null
  starts_on: ColumnType<string, string, never>
  ends_on: ColumnType<string, string, never>
  product_id: string | null
  category_id: string | null
  source: string
  created_by: string
  created_at: GeneratedTimestamp
  archived_at: NullableTimestamp
}

export interface MetricSnapshotTable {
  id: Generated<string>
  tenant_id: string
  metric_key: string
  entity_type: string
  entity_id: string | null
  calculation_version: string
  source_from: Timestamp
  source_to: Timestamp
  source_ids: JsonValue
  configuration: JsonValue
  inputs: JsonValue
  result: JsonValue
  completeness: JsonValue
  generated_at: GeneratedTimestamp
  published: boolean
}

export type ForecastTargetType = "product_demand" | "monthly_revenue"
export type ForecastMethod =
  | "ols_trend"
  | "seasonal_ols"
  | "naive_last_value"
  | "unavailable"
export type ForecastStatus =
  | "completed"
  | "insufficient_data"
  | "poor_data_quality"
  | "baseline_not_beaten"
export type ConfidenceLabel = "high" | "medium" | "low" | "unavailable"

export interface ForecastRunTable {
  id: Generated<string>
  tenant_id: string
  target_type: ForecastTargetType
  product_id: string | null
  method: ForecastMethod
  calculation_version: string
  configuration: JsonValue
  training_from: Timestamp
  training_to: Timestamp
  bucket_count: number
  eligible_bucket_count: number
  data_quality: JsonValue
  model_metrics: JsonValue
  baseline_metrics: JsonValue
  confidence_score: ColumnType<string | null, number | string | null, never>
  confidence_label: ConfidenceLabel
  status: ForecastStatus
  limitations: JsonValue
  source_snapshot_ids: JsonValue
  created_by: string
  created_at: GeneratedTimestamp
  published: boolean
}

export interface ForecastPointTable {
  id: Generated<string>
  tenant_id: string
  forecast_run_id: string
  bucket_start: ColumnType<string, string, never>
  horizon: number
  point_estimate: ColumnType<string, number | string, never>
  lower_limit: ColumnType<string | null, number | string | null, never>
  upper_limit: ColumnType<string | null, number | string | null, never>
  seasonal_factor: ColumnType<string | null, number | string | null, never>
  operational_value: ColumnType<string, number | string, never>
  created_at: GeneratedTimestamp
}

export interface ForecastBacktestTable {
  id: Generated<string>
  tenant_id: string
  forecast_run_id: string
  origin_bucket: ColumnType<string, string, never>
  horizon: number
  actual: ColumnType<string, number | string, never>
  predicted: ColumnType<string, number | string, never>
  naive_predicted: ColumnType<string, number | string, never>
  residual: ColumnType<string, number | string, never>
  created_at: GeneratedTimestamp
}

export interface RecommendationRunTable {
  id: Generated<string>
  tenant_id: string
  calculation_version: string
  configuration: JsonValue
  source_snapshot_ids: JsonValue
  status: "completed" | "poor_data_quality" | "insufficient_data"
  counts: JsonValue
  created_by: string
  created_at: GeneratedTimestamp
}

export type RecommendationType = "replenishment" | "promotion" | "overstock_review"

export interface RecommendationTable {
  id: Generated<string>
  tenant_id: string
  recommendation_run_id: string
  recommendation_type: RecommendationType
  product_id: string
  evidence_metrics: JsonValue
  proposed_value: JsonValue
  confidence_score: ColumnType<string | null, number | string | null, never>
  confidence_label: ConfidenceLabel
  state: "pending" | "accepted" | "rejected"
  reviewer_id: string | null
  reviewed_at: NullableTimestamp
  review_reason: string | null
  created_at: GeneratedTimestamp
}

export interface ExportArtifactTable {
  id: Generated<string>
  tenant_id: string
  job_run_id: string
  filename: string
  content_type: "text/csv; charset=utf-8"
  content: string
  row_count: number
  sha256: string
  created_at: GeneratedTimestamp
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
  categories: CategoryTable
  units: UnitTable
  products: ProductTable
  product_price_history: ProductPriceHistoryTable
  product_cost_history: ProductCostHistoryTable
  inventory_balances: InventoryBalanceTable
  stock_movements: StockMovementTable
  stock_counts: StockCountTable
  stock_count_items: StockCountItemTable
  stockout_intervals: StockoutIntervalTable
  inventory_daily_snapshots: InventoryDailySnapshotTable
  tenant_sequences: TenantSequenceTable
  customers: CustomerTable
  suppliers: SupplierTable
  product_suppliers: ProductSupplierTable
  purchase_orders: PurchaseOrderTable
  purchase_order_items: PurchaseOrderItemTable
  goods_receipts: GoodsReceiptTable
  goods_receipt_items: GoodsReceiptItemTable
  cash_registers: CashRegisterTable
  cash_register_assignments: CashRegisterAssignmentTable
  cash_sessions: CashSessionTable
  cash_movements: CashMovementTable
  cash_close_counts: CashCloseCountTable
  sales: SaleTable
  sale_items: SaleItemTable
  payments: PaymentTable
  sale_returns: SaleReturnTable
  sale_return_items: SaleReturnItemTable
  sale_return_refunds: SaleReturnRefundTable
  service_order_columns: ServiceOrderColumnTable
  service_orders: ServiceOrderTable
  service_order_status_history: ServiceOrderStatusHistoryTable
  job_runs: JobRunTable
  export_artifacts: ExportArtifactTable
  business_calendar_events: BusinessCalendarEventTable
  metric_snapshots: MetricSnapshotTable
  forecast_runs: ForecastRunTable
  forecast_points: ForecastPointTable
  forecast_backtests: ForecastBacktestTable
  recommendation_runs: RecommendationRunTable
  recommendations: RecommendationTable
}
