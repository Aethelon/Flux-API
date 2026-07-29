# Flux API Architecture

This document defines the target architecture and business rules. It is not a claim
that every planned capability is already implemented. The verified delivery status and
known gaps are tracked in [docs/implementation-status.md](./docs/implementation-status.md).

## 1. Purpose

Flux API is the backend for a multi-tenant retail, inventory, cash-register, customer, employee, service-order, analytics, and decision-support system.

The first backend version must:

- replace all frontend mock data with persisted data;
- enforce business rules and permissions on the server;
- preserve a complete and reviewable history of business operations and state changes;
- calculate deterministic KPIs, forecasts, replenishment suggestions, and promotion candidates;
- optionally use either Gemini Lite or Claude Haiku to explain validated analytical results;
- remain simple enough to be implemented and operated as a modular monolith.

The backend, not the frontend or the language model, is the source of truth for permissions, money, inventory, cash, KPIs, forecasts, and recommendations.

## 2. Scope and non-goals

### In scope

- Authentication, session renewal, and role-based authorization.
- Tenant and tenant-setting management.
- Employee and cash-register assignment management.
- Products, categories, units, prices, costs, and suppliers.
- Inventory balances, movements, reservations, stock counts, and receipts.
- Customers.
- Sales, sale items, discounts, payments, returns, and cancellations.
- Cash-register opening, closing, sales movements, supplies, withdrawals, and reconciliation.
- Service orders and status history.
- Operational history and administrative audit history.
- Dashboard KPIs and sales-history KPIs.
- Demand and revenue forecasts based on deterministic statistical methods.
- Inventory turnover, stockout risk, replenishment, and promotion suggestions.
- AI-generated explanations based only on backend-calculated facts.

### Out of scope for the first version

- Fiscal invoice issuance and government tax integrations.
- Accounting integrations.
- Marketplace and e-commerce integrations.
- Payment-card processing or storage of card data.
- Autonomous purchasing, pricing, promotion, inventory, or cash actions.
- Advanced machine-learning models. The first version uses linear regression, optional deterministic seasonal adjustment, and documented inventory formulas.
- Economic order quantity (EOQ) until ordering cost, freight cost, and holding cost are collected reliably.

## 3. Architecture decisions

### 3.1 Application shape

Use a modular monolith with one runtime entry point for the D'lara pilot:

1. `api`: synchronous HTTP API with an embedded scheduler for exports, analytics,
   forecasts, recommendations, AI jobs, inventory snapshots, and housekeeping.

Job state remains persisted in PostgreSQL. The scheduler may become a separate process
later only after measured load requires independent scaling.

Modules must own their application services and database access boundaries:

- `auth`
- `tenants`
- `employees`
- `catalog`
- `customers`
- `inventory`
- `sales`
- `cash`
- `service-orders`
- `history`
- `analytics`
- `intelligence`
- `audit`
- `jobs`

Do not split these modules into microservices in the first version. A single transactional database is important for inventory, sale, payment, and cash consistency.

### 3.2 Proposed stack

- TypeScript on an active Node.js LTS release.
- Fastify for the HTTP server.
- PostgreSQL as the primary and analytical database for the first version.
- Kysely as the typed PostgreSQL query layer with versioned migrations.
- JSON Schema validation shared by requests, responses, OpenAPI, and structured AI outputs where applicable.
- OpenAPI documentation generated from route schemas.
- A PostgreSQL transactional outbox and database-backed job queue initially.
- Containerized local and production execution.

Redis or an external queue may be introduced later only after a measured need. The initial design must not require it.

### 3.3 Internal dependency rule

HTTP handlers call application services. Application services enforce authorization and invariants, then call repositories. Repositories are the only layer that issues domain SQL. Analytics reads immutable facts and snapshots; it must not mutate operational transactions. The AI adapter reads approved analytical snapshots and cannot call operational write services.

## 4. Shared data rules

### 4.1 Tenant isolation

- Every tenant-owned table contains `tenant_id`.
- Every primary or alternate lookup includes `tenant_id` in its predicate.
- Tenant identity comes from the authenticated server-side session, never from a client-selectable tenant ID.
- Relevant unique constraints include `tenant_id`, for example `(tenant_id, barcode)`.
- Background jobs carry a validated `tenant_id` and process one tenant at a time.
- Cross-tenant administration, if ever required, must use a separate platform role and interface; it is not part of the first version.

### 4.2 Identifiers, time, and money

- Use UUIDs generated by the server for externally visible entity IDs.
- Store timestamps in UTC with timezone-aware PostgreSQL types.
- Store the tenant IANA timezone in settings. Default business-day grouping is `America/Recife` until the tenant changes it.
- Convert UTC timestamps to the tenant timezone before assigning day, week, or month buckets.
- Store money as integer cents in application contracts and `BIGINT` columns, or as fixed-scale PostgreSQL decimal values. Never calculate money with JavaScript binary floating point.
- Store quantities as fixed-scale decimals when fractional units are allowed and integers when the unit is indivisible.
- Round money once, at the documented allocation or settlement boundary, using decimal arithmetic.

### 4.3 Record lifecycle

- Master data uses `created_at`, `updated_at`, and optional `archived_at`.
- Business ledgers are append-only and are never hard-deleted.
- A correction to a ledger creates a reversal or compensating record linked to the original.
- Archived products, customers, or employees remain resolvable in historical records.
- Sales and service-order items store name, price, cost, and other required snapshots so later master-data edits cannot rewrite history.

### 4.4 Concurrency and idempotency

- State-changing public endpoints accept an `Idempotency-Key` header.
- Persist `(tenant_id, authenticated_user_id, route, idempotency_key, request_hash, response_status, response_body)` with expiration.
- Reusing a key with a different request hash returns `409 Conflict`.
- Sale completion, return, cash opening/closing, stock count, and inventory receipt run inside database transactions.
- Lock the affected cash session and inventory rows during critical writes.
- Use atomic conditional stock updates or row locks to prevent overselling.
- Use unique constraints to enforce one active cash session per register and, where required, per operator.

## 5. Authentication and authorization

### 5.1 Authentication

- Store passwords only as versioned Node.js `scrypt` hashes with random salts. Never log or audit password values.
- Use short-lived signed access tokens and rotating refresh tokens.
- Store refresh-token hashes, device/session metadata, creation time, expiration time, and revocation time.
- Revoke the previous refresh token during rotation. Reuse of a revoked token revokes the token family.
- Access-token claims contain user ID, tenant ID, session ID, and role. The API confirms that the user and session remain active for sensitive operations.
- Login, failed login, refresh, logout, password reset, role change, and session revocation create security audit events without secret values.

### 5.2 Supported roles

- `admin`: full access to operational and management resources.
- `funcionario`: access only to operational resources required for daily work.

The authenticated role comes from the server-side user record. The API never accepts a role from the request body, query string, or frontend state as authorization evidence.

### 5.3 Permission matrix

| Resource | `admin` | `funcionario` |
| --- | --- | --- |
| Dashboard data and KPIs | Allowed | Denied |
| Intelligence, analytics, and forecasts | Allowed | Denied |
| Operate the assigned current cash session: open, close, withdrawal, and supply | Allowed | Allowed |
| View the assigned current cash session and its movements | Allowed | Allowed |
| Cash-register administration, other registers, closed-session history, and historical reconciliation | Allowed | Denied |
| Employee management | Allowed | Denied |
| Sales history records | Allowed | Denied |
| Sales history KPIs and revenue aggregates | Allowed | Denied |
| Point of sale | Allowed | Allowed, using the user's assigned open cash session |
| Orders, inventory, and customers | Allowed | Allowed |

### 5.4 Authorization behavior

- Admin-only resource groups include `/dashboard`, `/intelligence`, cash-register administration and closed-session history, `/employees`, and all `/history` endpoints.
- A `funcionario` may open only the register assigned to the authenticated user; operate only that current session; and close only that same active session.
- Employee-scoped cash operations derive employee and register IDs from the authenticated server-side context. The client cannot choose them.
- A `funcionario` cannot access sales or service history records, history KPIs, or historical reconciliation.
- A `funcionario` may retrieve the operational totals and movements of only the currently active assigned session, including sales, withdrawals, and supplies.
- A `funcionario` may create a withdrawal or supply only in that current assigned session. The amount must be positive, the reason is mandatory, and a withdrawal cannot exceed the available cash amount calculated by the server.
- A `funcionario` cannot list closed cash sessions, reopen a session, retrieve historical reconciliation, query another register, or use cash-administration endpoints.
- Missing, invalid, or expired authentication returns `401 Unauthorized`.
- Valid authentication without permission returns `403 Forbidden`.
- A resource from another tenant returns `404 Not Found` where revealing its existence would leak information.

## 6. Domain model and persistence

The names below describe required logical tables. Exact physical names may follow the project's naming convention.

### 6.1 Tenancy and identity

- `tenants`: company identity, status, creation, and archive timestamps.
- `tenant_settings`: timezone, currency, forecast settings, service level, review period, promotion limits, retention configuration, and active AI provider.
- `tenant_sequences`: atomic per-tenant counters for human-readable sale, order, receipt, and service-order numbers.
- `users`: tenant, employee profile, name, email, phone, password hash, role, status, and archive timestamp.
- `auth_sessions`: refresh-token hash/family, device metadata, expiration, revocation, and last use.
- `cash_register_assignments`: user, register, validity interval, assigning admin, and reason.

Assignment history must use validity intervals instead of overwriting the previous assignment.

### 6.2 Catalog and supply

- `categories`: tenant category hierarchy and state.
- `units`: tenant unit code, label, divisibility, and quantity scale.
- `products`: SKU, barcode, type (`raw_material`, `finished_product`, `packaging`, or `service`), name, description, category, unit, state, minimum stock, and current selling price.
- `product_price_history`: product, old/new price, effective time, actor, and reason.
- `product_cost_history`: product, cost, source, effective time, actor, and reason.
- `suppliers`: supplier identity and contact fields.
- `product_suppliers`: supplier-product relation, supplier SKU, active flag, configured lead time, minimum order quantity, pack multiple, and validity interval.
- `business_calendar_events`: tenant-defined event name, recurring key, start/end dates, product/category scope, source, and archive timestamp.
- `purchase_orders`: supplier, state, order time, expected time, creator, approval data, and optional recommendation source.
- `purchase_order_items`: product, ordered quantity, received quantity, agreed unit cost, and supplier pack data.
- `goods_receipts`: purchase order, receipt time, state, receiving user, supplier document reference, and reversal data.
- `goods_receipt_items`: purchase-order item, received quantity, accepted unit cost, and lot/reference data when available.

Price and cost history are required for reproducible revenue, margin, promotion, and inventory-value calculations. A missing cost is represented as unknown, never as zero.

### 6.3 Inventory

- `inventory_balances`: one current row per tenant and stock-managed product with `on_hand`, `reserved`, and version.
- `stock_movements`: append-only quantity ledger with movement type, signed quantity, resulting balance, unit cost snapshot, source entity, source ID, actor, occurred time, and reversal link.
- `inventory_daily_snapshots`: product, tenant-local date, opening, received, sold, returned, adjusted, closing, reserved, in-stock minutes, and stockout minutes.
- `stockout_intervals`: product, start, end, detected reason, and source movement.
- `stock_counts`: count header, state, start/end, actor, and reason.
- `stock_count_items`: expected, counted, difference, and generated movement reference.

Allowed movement types include receipt, sale, sale reversal, return, reservation, reservation release, positive adjustment, negative adjustment, stock-count adjustment, and transfer when multiple locations are added.

Services do not have inventory balances or stock movements.

### 6.4 Customers

- `customers`: name, contact fields, notes, state, consent/retention metadata, and archive timestamp.
- Historical transactions reference the customer ID where present but keep transaction snapshots needed for review.
- Privacy-driven anonymization may remove customer contact fields without removing financial facts or ledger integrity.

### 6.5 Sales

- `sales`: business number, status, customer, operator, cash session, gross amount, discount, net amount, returned amount, change amount, tenant-local business date, completion time, cancellation data, and version.
- `sale_items`: product/service reference, name/type/unit snapshots, quantity, unit price, gross amount, allocated discount, net amount, unit cost snapshot, returned quantity, and service-order reference where applicable.
- `payments`: sale, method (`cash`, `credit`, `debit`, or `pix`), amount, installments when relevant, status, and non-sensitive external reference.
- `returns`: original sale, operator, reason, total, state, completion time, and optional cash session.
- `return_items`: original sale item, quantity, amount, restock decision, cost snapshot, and movement reference.

Never store full card numbers, security codes, magnetic-stripe data, or payment credentials.

### 6.6 Cash management

- `cash_registers`: tenant register, name/code, state, and archive timestamp.
- `cash_sessions`: register, opening operator, opening time/amount, closing operator/time, state, expected totals by payment method, counted totals by method, differences, and closing note.
- `cash_movements`: append-only movement ledger for opening, cash sale, sale reversal, return, supply, withdrawal, and closing adjustment; includes amount, method, source, actor, reason, occurred time, and reversal link.
- `cash_close_counts`: session, payment method, counted amount, expected amount, difference, actor, and time.

### 6.7 Service orders

- `service_orders`: business number, customer, title, description, priority, due time, estimated value, final sale reference, current status, responsible user, completion time, and version.
- `service_order_columns`: tenant-defined label, semantic type (`open`, `completed`, or `cancelled`), color token, display position, protected flag, and archive timestamp.
- `service_order_status_history`: append-only previous/new status, actor, time, reason, and metadata.

Status transitions must follow a server-defined state machine. The required completed column is protected from deletion, although its label and color may change. Completed orders remain on the active board for two tenant-local calendar days by default and then appear only in complete history queries. Cancelled orders follow their configured board-visibility rule. This is a query rule, never data deletion. Completing or billing the same order twice is prohibited by a unique constraint and idempotent command.

### 6.8 Derived states

The database stores business facts and lifecycle state; the backend derives display state consistently:

- An archived product is inactive regardless of inventory.
- A service has no inventory state and is shown as on demand while active.
- An active stock-managed product with `on_hand <= 0` is sold out.
- An active stock-managed product with `0 < on_hand <= minimum_stock` has low stock.
- Other active stock-managed products are available.

The API may return this derived `inventory_status`, but clients must not persist or send it as authoritative input. This prevents the duplication that existed between prototype data and frontend recalculation.

### 6.9 Historical, analytical, and AI tables

- `audit_events`: immutable administrative and state-change audit trail.
- `outbox_events`: transactional events awaiting background processing.
- `idempotency_records`: replay protection and stored responses.
- `job_runs`: schedule, attempt, status, cursor, counts, error class, start, and finish.
- `metric_snapshots`: versioned deterministic KPI inputs and results.
- `forecast_runs`: target, method version, configuration, training window, data-quality result, metrics, and status.
- `forecast_points`: run, future bucket, point estimate, lower/upper limits, and optional seasonal factor.
- `forecast_backtests`: run, origin, horizon, actual, predicted, naive baseline, and residual.
- `recommendation_runs`: method version, configuration, source snapshot IDs, and status.
- `recommendations`: type, product, evidence metrics, proposed value, confidence, state, and reviewer decision.
- `ai_runs`: provider, pinned model, prompt/schema version, sanitized input hash, source snapshot IDs, structured output, token counts, latency, estimated cost, status, and error classification.
- `ai_insights`: run, type, text, severity, ordered source metric IDs, review state, reviewer, and review time.

### 6.10 Required constraints and indexes

Database constraints are a final defense in addition to application validation:

- unique active user email per tenant;
- unique non-empty barcode per tenant;
- one inventory balance per tenant and stock-managed product;
- unique business number per tenant and entity type;
- partial unique constraints for active cash sessions;
- checks for non-negative prices, costs, payment amounts, counts, and quantities where the movement model does not use a signed value;
- checks that returned quantity never exceeds the quantity available to return;
- foreign keys that restrict deletion of referenced business facts;
- optimistic `version` columns on concurrently editable master records and service orders.

Primary history indexes begin with tenant and time, with the ID as deterministic tie-breaker, for example `(tenant_id, occurred_at DESC, id DESC)`. Add source-reference indexes to movements, status histories, audit events, forecasts, and AI runs. Partial indexes may cover active products, open cash sessions, pending outbox rows, and unfinished jobs. Index selection must be validated with representative query plans before production; do not add speculative duplicate indexes.

## 7. Immutable history and audit

### 7.1 Required historical guarantees

History supports operational review, deterministic recalculation, forecast evaluation, and AI evidence. Therefore:

- Completed sales, sale items, payments, returns, stock movements, cash movements, cash sessions, price/cost changes, register assignments, order transitions, forecast runs, recommendations, and AI runs are retained.
- Ledger rows cannot be updated or deleted through application roles.
- Corrections create compensating records and retain links to the original record.
- Every analytical result stores its calculation version, configuration, source window, source snapshot IDs, and generation time.
- Re-running the same calculation never destroys the previous run. One run may be marked as the currently published result.
- AI output never replaces deterministic results. It is stored as a separately versioned interpretation.

### 7.2 Audit event format

Each material state change writes an `audit_events` row in the same database transaction as the change:

- `event_id`
- `tenant_id`
- `occurred_at`
- `actor_type` (`user`, `system`, or `job`)
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `request_id`
- `correlation_id`
- `source` (`api`, `worker`, `migration`, or `system`); `worker` identifies background
  job execution even while the scheduler is embedded in the API process
- `reason`
- redacted `before_json`
- redacted `after_json`
- client IP and user-agent when justified for security review

Passwords, password hashes, access/refresh tokens, API keys, authorization headers, full payment-card data, and provider secrets must never be stored in audit payloads.

### 7.3 Retention and integrity

- Operational financial and inventory history is retained according to the applicable business/legal policy; no arbitrary automatic deletion is applied.
- Security logs and request metadata use a documented retention period in `tenant_settings` or deployment policy.
- Large append-only tables may be partitioned by month without changing logical behavior.
- Encrypt backups and provider credentials at rest and connections in transit.
- Enable automated backups and point-in-time recovery in production.
- Perform and record restore tests periodically.
- Optionally add a chained hash over audit batches for tamper evidence. Database permissions remain the primary control.
- Privacy requests anonymize eligible personal fields while retaining non-personal business facts and referential integrity.

## 8. Core transactional workflows

### 8.1 Complete a sale

Within one transaction:

1. Resolve the tenant, operator, and assigned open cash session.
2. Lock the cash session and affected inventory balances.
3. Validate product/service state, price snapshots, quantities, discount authorization, payment totals, and stock availability.
4. Allocate the sale discount across items using the documented monetary rule.
5. Insert the completed sale, item snapshots, and payment records.
6. Decrease stock atomically for stock-managed items and append stock movements.
7. Append cash movements for relevant payment methods without exposing admin-only balances to the operator.
8. Update a linked service order at most once when applicable.
9. Insert audit and outbox events.
10. Commit and return the stored result.

The operation is idempotent. A failed step rolls back every step.

### 8.2 Cancel or return a sale

- A draft may be cancelled without financial movements, but the state transition is audited.
- A completed sale is never edited back into a draft.
- A cancellation or return creates reversal/return records, restores inventory only when the item is physically returned and eligible, and records any cash impact in the appropriate open session.
- Returned quantity cannot exceed sold quantity minus prior returns.
- The original sale remains intact and points to its adjustments.

### 8.3 Open and close a cash session

- The assigned employee opens their own register with an opening amount.
- The API prevents a second active session for the register or operator according to configuration.
- The employee can see and operate only the assigned current session, including its operational totals and movements.
- The employee may record withdrawals and supplies in that current session. Each manual movement requires a reason and is linked to the authenticated employee.
- Closed-session history and historical reconciliation are available only to an admin, including history belonging to the requesting employee.
- Closing stores expected and counted values per payment method and the difference. The original movements remain unchanged.
- Reopening or correcting a closed session requires an explicit admin correction workflow and audit reason; it must not erase the prior close.

### 8.4 Receive or adjust inventory

- A receipt appends stock movements and updates product cost history when an accepted cost changes.
- Initial stock is posted as a positive adjustment, never written directly into the current balance.
- Receipts and positive adjustments require an accepted unit-cost snapshot. Negative adjustments use the current moving-average cost snapshot.
- A manual adjustment requires a reason and permission.
- A stock count captures the expected balance when its draft is created. Each product appears once.
- Confirmation locks the count, items, products, and balances in product-ID order. If stock changed after the draft started, confirmation is rejected and a new count is required.
- A stock count posts only the difference between expected and counted values after confirmation. A zero difference creates no movement.
- Confirmed and cancelled counts are immutable. Cancellation records its actor, time, and reason without changing stock.
- Every movement records its source document and the balance resulting from the movement.
- Products cannot change between service and stock-managed types after creation because that would invalidate their inventory-history semantics.
- Movements update tenant-local daily inventory snapshots and stockout intervals transactionally. The embedded background scheduler closes incomplete snapshots after the tenant-local day ends.

## 9. HTTP API design

### 9.1 Conventions

- Base path: `/api/v1`.
- JSON request and response bodies.
- OpenAPI describes every public route and error response.
- Pagination uses opaque cursor pagination for growing histories; bounded page/limit pagination is acceptable for small master-data lists.
- Filtering timestamps are ISO 8601 with explicit timezone.
- List endpoints have deterministic ordering and an ID tie-breaker.
- Concurrently editable resources expose a version or ETag. Updates require the last observed version and return `409 Conflict` on a stale write.
- Errors use a stable shape: `code`, `message`, `fieldErrors`, `requestId`, and optional safe `details`.
- Mutating commands return the resulting resource or an asynchronous job ID.
- Long-running exports, forecasts, and AI insight generation return `202 Accepted` with a job resource.

### 9.2 Initial route groups

Authentication:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Catalog and inventory:

- `/api/v1/categories`
- `/api/v1/units`
- `/api/v1/products`
- `/api/v1/products/:id/price-history`
- `/api/v1/products/:id/cost-history`
- `/api/v1/inventory/balances`
- `/api/v1/inventory/movements`
- `/api/v1/inventory/counts`
- `/api/v1/purchase-orders`
- `/api/v1/goods-receipts`
- `/api/v1/suppliers`

Customers and employees:

- `/api/v1/customers`
- `/api/v1/employees` (`admin` only)
- `/api/v1/cash-register-assignments` (`admin` only)

Sales and history:

- `POST /api/v1/sales`
- `GET /api/v1/sales/:id` (`admin` only)
- `POST /api/v1/sales/:id/cancel`
- `POST /api/v1/sales/:id/returns`
- `GET /api/v1/history/sales` (`admin` only)
- `GET /api/v1/history/kpis` (`admin` only)

History records, details, and aggregates are restricted to administrators.

Cash:

- `GET /api/v1/cash-registers/me`: returns the assigned current session and its operational movements, or closed status; it never returns prior sessions.
- `POST /api/v1/cash-registers/me/open`
- `POST /api/v1/cash-registers/me/supplies`
- `POST /api/v1/cash-registers/me/withdrawals`
- `POST /api/v1/cash-registers/me/close`
- `/api/v1/cash-registers` (`admin` only except the `/me` routes)
- `/api/v1/cash-sessions` (`admin` only)
- `POST /api/v1/cash-sessions/:id/supplies` (`admin` only)
- `POST /api/v1/cash-sessions/:id/withdrawals` (`admin` only)

Service orders:

- `/api/v1/service-orders`
- `/api/v1/service-order-columns`
- `POST /api/v1/service-orders/:id/transitions`

Dashboard and intelligence:

- `GET /api/v1/dashboard` (`admin` only)
- `GET /api/v1/intelligence/forecasts` (`admin` only)
- `POST /api/v1/intelligence/forecasts/runs` (`admin` only)
- `GET /api/v1/intelligence/recommendations` (`admin` only)
- `POST /api/v1/intelligence/recommendations/:id/review` (`admin` only)
- `GET /api/v1/intelligence/insights` (`admin` only)
- `POST /api/v1/intelligence/insights/runs` (`admin` only)

Audit and jobs:

- `GET /api/v1/audit-events` (`admin` only)
- `GET /api/v1/jobs/:id` (`admin` only)

Exports must apply the same tenant, role, field-level, and aggregate restrictions as their source endpoints.

## 10. Outbox and background jobs

### 10.1 Transactional outbox

A domain write and its `outbox_events` record are committed in the same transaction.
When an external integration is introduced, its consumer must claim pending rows with
row-level locking, publish/process them, and record attempts and completion. Processing
is at-least-once, so every consumer must be idempotent. The D'lara pilot persists and
monitors outbox rows but does not run an external integration consumer.

Typical events:

- `sale.completed`
- `sale.returned`
- `inventory.movement_posted`
- `cash.session_closed`
- `service_order.status_changed`
- `product.price_changed`
- `product.cost_changed`
- `purchase_order.submitted`
- `goods_receipt.posted`

### 10.2 Scheduled jobs

- Daily: close inventory daily snapshots after the tenant-local day ends.
- Daily: compute operational metrics and detect stockout intervals/data gaps.
- Daily or configurable: product demand forecasts and replenishment recommendations.
- Weekly or configurable: low-turnover and promotion candidates.
- Monthly: revenue forecast and model backtest summaries.
- After deterministic analytics: optional AI explanation generation.
- Periodic: outbox retries, expired idempotency cleanup, session cleanup, partition maintenance, and integrity checks.

Jobs store their run, cursor, calculation version, attempts, results, and errors. A retry resumes safely and does not duplicate published results.

## 11. Analytical data preparation

### 11.1 Source of truth

Analytics reads completed business facts and immutable adjustments. It does not infer facts from current master-data values.

For product `p` and tenant-local time bucket `t`, net observed units are:

```text
y[p,t] = completed_sold_quantity[p,t] - returned_quantity[p,t]
```

Rules:

- Exclude drafts and cancelled transactions.
- Post-sale returns reduce demand in a documented policy: use the original sale bucket for model training and retain the return date separately for financial reporting.
- Exclude services from stock and replenishment calculations, but include them in service revenue metrics.
- Preserve zero-demand buckets; do not drop them.
- Mark buckets with incomplete history, migrations, or system downtime.
- Record in-stock minutes and stockout minutes. A zero during a stockout is censored demand, not proof of zero customer demand.
- By default, exclude buckets with excessive stockout coverage from regression training, and store the exclusion reason.
- Do not invent lost-sales quantities unless the product starts collecting explicit unmet-demand events.

### 11.2 Dataset eligibility

A forecast run stores all inclusion decisions. Initial defaults are versioned configuration, not hard-coded permanent truth:

- At least 3 eligible buckets for a regression result.
- Prefer at least 12 monthly buckets for planning output.
- Require at least 2 complete seasonal cycles before seasonal adjustment, such as 24 monthly buckets for month-of-year factors.
- Reject a forecast when source completeness or time ordering cannot be verified.
- Report `insufficient_data`, `poor_data_quality`, or `baseline_not_beaten` instead of presenting an unreliable number as valid.

## 12. Predictive mathematics

All formulas are implemented with deterministic numeric code, covered by unit tests, and identified by a `calculation_version`. The AI provider does not perform or correct these calculations.

### 12.1 Ordinary least-squares trend

For `n` eligible equally spaced buckets, assign `x_t = 0, 1, ..., n - 1` and observed demand `y_t`.

```text
x_bar = (1/n) * sum(x_t)
y_bar = (1/n) * sum(y_t)
Sxx   = sum((x_t - x_bar)^2)
Sxy   = sum((x_t - x_bar) * (y_t - y_bar))
b     = Sxy / Sxx
a     = y_bar - b * x_bar
trend(x) = a + b * x
```

The non-seasonal point forecast at future index `x_h` is:

```text
y_hat_h = max(0, a + b * x_h)
```

Return `insufficient_data` when `n < 3` or `Sxx = 0`. Retain the unrounded internal forecast and round only the operational quantity according to product unit divisibility.

### 12.2 Optional deterministic seasonality

Seasonality is applied only when at least two complete cycles exist and each seasonal position has sufficient eligible observations.

For each eligible historical bucket:

```text
r_t = y_t / max(epsilon, trend(x_t))
```

For seasonal position `m`, for example calendar month:

```text
raw_S_m = mean(r_t where season(t) = m)
S_m     = raw_S_m / mean(raw_S_1 ... raw_S_M)
```

The normalized factors have mean `1`. The seasonal forecast is:

```text
y_hat_h = max(0, (a + b * x_h) * S_season(h))
```

If the trend denominator is unstable, a season is missing, or the history requirement is not met, use `S_m = 1` and record why seasonality was disabled.

Named-event uplifts, such as a holiday promotion, are never invented. If the tenant records comparable event windows, an optional deterministic event factor may be calculated from forecasts produced without event information:

```text
event_ratio_j = actual_event_demand_j / max(epsilon, baseline_event_demand_j)
event_factor  = mean(event_ratio_j over eligible past occurrences)
```

Require at least two complete comparable occurrences, valid stock availability, and rolling-origin improvement over the same forecast without the event factor. Cap the factor with versioned configuration. Apply either the validated event adjustment or the ordinary seasonal adjustment when their effects overlap, unless a backtest proves the combined method; this prevents double counting. Without sufficient evidence, the API returns the event with `uplift = unavailable` and must not claim a percentage increase.

### 12.3 Residuals and fit metrics

For each training point:

```text
e_t   = y_t - y_hat_t
SSE   = sum(e_t^2)
MSE   = SSE / n
RMSE  = sqrt(MSE)
MAE   = sum(abs(e_t)) / n
```

For linear-regression residual variance with two fitted parameters:

```text
s^2 = SSE / (n - 2)
s   = sqrt(s^2)
```

Coefficient of determination:

```text
SST = sum((y_t - y_bar)^2)
R^2 = 1 - SSE / SST
```

If `SST = 0`, define `R^2 = 1` only when `SSE = 0`; otherwise the value is unavailable.

Use WAPE instead of MAPE because demand may be zero:

```text
WAPE = sum(abs(e_t)) / sum(abs(y_t))
bias = sum(e_t) / sum(abs(y_t))
```

WAPE and normalized bias are unavailable when the denominator is zero.

### 12.4 Prediction interval

For a non-seasonal OLS forecast at `x_0`, the standard prediction error is:

```text
SE_pred = s * sqrt(1 + 1/n + ((x_0 - x_bar)^2 / Sxx))
```

Using the Student t critical value with `n - 2` degrees of freedom:

```text
lower_95 = max(0, y_hat_0 - t(0.975, n - 2) * SE_pred)
upper_95 = max(0, y_hat_0 + t(0.975, n - 2) * SE_pred)
```

For a seasonal forecast, multiply the point and interval limits by the applicable positive normalized seasonal factor. Label this as the deterministic model interval; it does not account for censored lost demand or external market events.

### 12.5 Rolling-origin backtest and baseline

Before publishing a forecast, evaluate historical forecast origins without training on future data:

1. Choose the minimum training window.
2. Fit only buckets before each origin.
3. Forecast the configured horizon.
4. Compare predictions with actual eligible observations.
5. Aggregate MAE, RMSE, WAPE, and bias by horizon.

Compare against a naive baseline:

```text
naive_forecast[h] = last eligible observed value before the origin
```

If the regression WAPE is worse than the baseline WAPE beyond a configured tolerance, do not label it high confidence. The API either publishes the baseline as the safer forecast with `method = naive_last_value` or returns `baseline_not_beaten`, according to tenant configuration. The decision and both scores are stored.

### 12.6 Confidence score

The first version uses a transparent, versioned score:

```text
coverage_score     = min(1, eligible_bucket_count / preferred_bucket_count)
accuracy_score     = max(0, 1 - min(1, backtest_WAPE))
availability_score = in_stock_minutes / observed_minutes

confidence = 100 * (
    0.35 * coverage_score
  + 0.45 * accuracy_score
  + 0.20 * availability_score
)
```

Labels:

- `high`: score greater than or equal to 75 and the model is not worse than baseline.
- `medium`: score greater than or equal to 50 and below 75.
- `low`: score below 50, missing backtest metrics, or materially worse than baseline.

Weights and thresholds are stored with the run. A low-confidence output is not used for automatic decisions.

### 12.7 Revenue, cost, and margin

At sale-item level:

```text
line_gross = quantity * unit_price_snapshot
```

Allocate an order-level discount proportionally:

```text
exact_line_discount_i = order_discount * line_gross_i / sum(line_gross)
```

Round line allocations to cents and assign the final rounding remainder deterministically to the largest line, using line ID as a tie-breaker. Then:

```text
line_net_revenue = line_gross - allocated_discount - returned_net_amount
COGS             = net_quantity_sold * unit_cost_snapshot
gross_profit     = net_revenue - COGS
gross_margin     = gross_profit / net_revenue
```

Rules:

- Revenue is unavailable only when its transaction facts are invalid.
- COGS, gross profit, and gross margin are unavailable unless cost completeness is 100% for the represented items.
- Never treat an unknown cost as zero.
- Payment method does not change recognized sale revenue.
- Cash change reduces the effective cash received; it is not a discount or expense.

Monthly net revenue may use the same OLS, seasonality, interval, and backtest process as demand, with currency calculations performed in decimal arithmetic.

For purchased stock, the first version uses perpetual moving weighted-average cost. Before a receipt, let `q_old` be on-hand quantity at average cost `c_old`; let the accepted receipt contain `q_in` at unit cost `c_in`:

```text
new_average_cost = (q_old * c_old + q_in * c_in) / (q_old + q_in)
```

Apply the formula when `q_old + q_in > 0`. A sale snapshots the current average cost. A return uses the original sale item's cost snapshot; if returned to sellable stock, that same cost re-enters inventory. Positive manual adjustments require an explicit cost source. Negative stock is prohibited, avoiding undefined average-cost behavior. Until bill-of-material and production-consumption features enter scope, costs for internally produced items are admin-maintained estimates and every affected margin is labeled `estimated_cost`.

### 12.8 Demand statistics for replenishment

Use eligible in-stock daily observations over a configurable window:

```text
d_bar   = mean(daily_net_demand)
sigma_d = sample_standard_deviation(daily_net_demand)
```

Inventory position is:

```text
IP = on_hand + confirmed_on_order - reserved
```

If lead time `L` is constant in days, lead-time demand and safety stock are:

```text
mean_lead_demand = d_bar * L
SS = z * sigma_d * sqrt(L)
```

If historical lead time varies independently from demand:

```text
L_bar   = mean(observed_lead_time_days)
sigma_L = sample_standard_deviation(observed_lead_time_days)
SS = z * sqrt(L_bar * sigma_d^2 + d_bar^2 * sigma_L^2)
```

Default cycle service level is 95%, where `z = 1.645`, and is configurable per tenant or product. Supported service levels map to stored standard-normal quantiles.

Reorder point:

```text
ROP = expected_demand_during_lead_time + SS
```

For a review period `R` days, the order-up-to target and suggestion are:

```text
target = expected_demand_over(L + R) + SS
Q_raw  = max(0, target - IP)
```

When daily forecasts are available, sum forecast points over the lead and review periods instead of using only `d_bar * days`. Round `Q_raw` up to the unit scale, supplier pack multiple, and minimum order quantity. Store each rounding step.

When observed supplier lead-time history is insufficient, use the configured lead time and label the result as assumption-based.

### 12.9 Days of cover and stockout risk

```text
days_of_cover = IP / d_bar
```

If `d_bar <= 0`, days of cover is unavailable rather than infinite.

With approximately normal lead-time demand:

```text
z_stock = (IP - mean_lead_demand) / sigma_lead_demand
stockout_probability = 1 - Phi(z_stock)
```

If `sigma_lead_demand = 0`, probability is `0` when `IP >= mean_lead_demand` and `1` otherwise. Store the normal-approximation assumption and do not show a false precision beyond the available input quality.

### 12.10 Inventory turnover

Use time-weighted daily inventory snapshots:

```text
average_on_hand_units = sum(daily_average_on_hand * covered_day_fraction)
                        / sum(covered_day_fraction)

unit_turnover = net_units_sold / average_on_hand_units
```

When cost completeness is 100%:

```text
average_inventory_cost = time_weighted_mean(on_hand_quantity * unit_cost)
inventory_turnover     = COGS / average_inventory_cost
days_inventory         = period_days / inventory_turnover
```

Return unavailable when a denominator is zero or when cost coverage is incomplete. A stockout-affected low sales period must be flagged so it is not mistaken for low customer interest.

### 12.11 Low-turnover and promotion suggestions

A product may become a promotion candidate only when all applicable rules are evaluated:

- active and stock-managed;
- inventory position exceeds the order-up-to target by a configured threshold;
- recent unit turnover is below its configured threshold;
- recent trend is flat or negative;
- stockout coverage does not invalidate the demand observation;
- the product is not already in an active conflicting promotion;
- price and cost data are current enough for a monetary suggestion.

Define:

```text
excess_units    = max(0, IP - target)
overstock_ratio = excess_units / max(IP, 1)
base_discount   = min(promotion_cap, k * overstock_ratio)
```

For selling price `P`, unit cost `C`, and required minimum gross margin `m_min`, the maximum discount rate that preserves the margin is:

```text
max_margin_safe_discount = 1 - C / (P * (1 - m_min))
max_safe_discount = clamp(max_margin_safe_discount, 0, promotion_cap)
suggested_discount = min(base_discount, max_safe_discount)
```

`k`, `promotion_cap`, `m_min`, thresholds, and their versions are stored with the recommendation. If cost is unknown, the system may flag overstock for review but must not propose a discount amount.

No promotion is activated autonomously. When an admin explicitly applies a valid promotion recommendation, the backend changes the current price and records the old/new price, actor, reason, recommendation, audit event, and outbox event in the same transaction. The application is rejected as stale if the product price changed after the recommendation was generated.

When an admin explicitly applies a valid replenishment recommendation, the backend creates and submits a purchase order linked to the recommendation, using the current supplier relation, purchase constraints, lead time, and product cost. Applying the recommendation never increases inventory; inventory changes only when the corresponding goods receipt is completed. Review-only overstock candidates record the administrator decision without changing price or stock.

### 12.12 Core KPI definitions

```text
gross_revenue        = sum(completed line gross)
net_revenue          = gross_revenue - discounts - returns
completed_sale_count = count(completed sales with net amount after returns according to report policy)
average_ticket       = net_revenue / completed_sale_count
units_sold           = sold quantity - returned quantity
```

Top products use `units_sold` or `net_revenue` as an explicit query parameter; the API never mixes rankings silently.

Service-order metrics:

```text
cycle_time       = completed_at - created_at
lateness         = max(0, completed_at - due_at)
on_time          = completed_at <= due_at
completion_rate  = completed_count / eligible_order_count
```

Cash closing, by method:

```text
expected_cash = opening_amount
              + net_cash_sales
              + supplies
              - withdrawals
              - cash_returns

expected_credit = net_credit_sales
expected_debit  = net_debit_sales
expected_pix    = net_pix_sales

difference_method = counted_method - expected_method
```

Every KPI response includes its date range, timezone, data freshness time, calculation version, and completeness flags.

## 13. AI architecture

### 13.1 Responsibility boundary

AI is an explanation layer, not a calculation or decision engine.

The deterministic backend:

- calculates every number;
- determines data quality and confidence;
- selects evidence metrics;
- creates recommendation candidates;
- validates permissions and tenant isolation;
- validates AI output before storage or display.

The AI provider may:

- summarize trends in clear language;
- explain forecast confidence and limitations;
- prioritize already-calculated risks and opportunities;
- draft non-binding actions for admin review.

The AI provider may not:

- receive unrestricted database access;
- call operational tools or endpoints;
- invent, recalculate, or alter metric values;
- open/close cash, change stock, prices, promotions, employees, or orders;
- make autonomous purchasing or financial decisions.

### 13.2 Provider adapter

Define one internal interface, for example:

```text
AiProvider.generateStructuredInsight(input, schema, options) -> validated result
```

Provide two adapters:

- Gemini API with a configured Flash-Lite model.
- Anthropic Messages API with a configured Claude Haiku model.

Only one provider is active for a run. Do not send the same business payload to both providers automatically. Provider and model are deployment configuration, not frontend input.

Initial candidate model IDs, subject to a documented pre-implementation verification:

- Gemini: `gemini-3.5-flash-lite`.
- Anthropic: pinned `claude-haiku-4-5-20251001`, not a moving alias in production.

Model IDs remain configurable because providers version and deprecate models. Record the exact provider and model ID on every run.

### 13.3 AI input contract

The input is a compact, sanitized analytical snapshot containing only:

- tenant-neutral context such as business type and timezone where needed;
- date range and data freshness;
- deterministic KPIs with IDs, values, units, formula versions, completeness, and confidence;
- forecast points and backtest metrics;
- precomputed replenishment or promotion candidates;
- explicit limitations and unavailable fields.

Do not send customer names, emails, phone numbers, employee personal data, transaction notes, IP addresses, credentials, or raw transaction history. Use aggregated data and opaque metric IDs. Confidential production data must use an appropriate paid API arrangement; it must not be sent through a provider tier whose terms allow product-improvement training or human review of prompts.

### 13.4 AI output contract

Require provider-supported structured JSON output with a versioned schema similar to:

```json
{
  "summary": "string",
  "strengths": [
    { "text": "string", "sourceMetricIds": ["metric-id"] }
  ],
  "risks": [
    {
      "severity": "low | medium | high",
      "text": "string",
      "sourceMetricIds": ["metric-id"]
    }
  ],
  "recommendations": [
    {
      "text": "string",
      "sourceMetricIds": ["metric-id"],
      "requiresHumanReview": true
    }
  ]
}
```

After provider schema validation, the backend must also:

- validate semantic constraints;
- reject unknown metric IDs;
- require evidence for every claim;
- reject numeric claims not present in the approved snapshot;
- enforce item and text-length limits;
- remove unsafe markup;
- store rejected output and reason only in a redacted diagnostic form.

The UI renders numeric values from the deterministic metric records, not by parsing model prose.

### 13.5 Reliability, privacy, and cost

- Use low temperature, normally `0` to `0.2`.
- Set explicit timeout, token, and output-size limits.
- Retry only transient rate-limit and server errors with exponential backoff and jitter.
- Use a circuit breaker after repeated provider failures.
- Cache by tenant, sanitized input hash, prompt version, schema version, provider, and model.
- A provider failure returns deterministic analytics with an `AI explanation unavailable` state; it never blocks sales or operational flows.
- For Gemini calls, use an endpoint/mode with storage disabled and set `store = false` whenever the selected API exposes that option.
- Apply the selected Anthropic commercial retention controls and avoid optional provider features that expand data exposure unless separately approved.
- Keep provider API keys only in the deployment secret manager.
- Log metadata, not prompts containing prohibited data.
- Enforce per-tenant daily token/cost budgets and global rate limits.

### 13.6 AI history and evaluation

Each `ai_runs` record preserves:

- provider and exact model ID;
- prompt, schema, and policy versions;
- sanitized input hash and source metric snapshot IDs;
- sanitized structured response;
- validation outcome and rejection reasons;
- request start/end, latency, input/output tokens, and estimated cost;
- retry count, provider request ID where safe, and error classification;
- reviewer acceptance/rejection and feedback.

Maintain a versioned evaluation set containing synthetic or anonymized metric snapshots and expected factual constraints. Evaluate both adapters for schema compliance, unsupported numerical claims, evidence references, latency, and cost before changing the production provider or model.

## 14. Security and privacy

- Validate every request at the API boundary and every provider response at the AI boundary.
- Apply tenant and authorization predicates in application services and repositories.
- Use parameterized SQL only.
- Set request-body, pagination, export, and upload limits.
- Rate-limit login, refresh, exports, forecast runs, and AI runs.
- Restrict CORS to configured frontend origins.
- Use secure HTTP headers and HTTPS in deployed environments.
- Keep secrets out of source control, logs, audit JSON, job payloads, and error responses.
- Redact sensitive fields centrally before structured logging.
- Use least-privilege database roles for migrations, the API runtime, analytics, and read-only administration.
- Protect CSV exports against formula injection and record who generated each export.
- Return generic authentication errors and stable safe domain errors.

## 15. Observability

- Generate a `request_id` for every HTTP request and propagate a `correlation_id` through outbox and job processing.
- Use structured logs with tenant ID, actor ID, route, status, duration, and error class, excluding prohibited data.
- Collect API latency/error metrics, database-pool metrics, outbox lag, job duration/failure, forecast freshness, data completeness, AI latency/token/cost, and provider error rate.
- Add health endpoints for process liveness and dependency readiness.
- Alert on repeated sale transaction failures, negative-stock invariant failures, stuck outbox rows, overdue analytics, backup failures, and abnormal AI spend.
- Audit history and operational logs are different: audit is a durable business/security record; logs are diagnostic and have shorter retention.

## 16. Testing strategy

### 16.1 Unit tests

- Permission matrix and field-level history restrictions.
- Money rounding and proportional discount allocation.
- Sale totals, returns, and cash expected-value formulas.
- OLS coefficients, seasonal normalization, residual metrics, prediction intervals, and zero-denominator cases.
- Rolling-origin backtests and naive-baseline comparison.
- Safety stock, reorder point, pack rounding, stockout probability, turnover, and promotion discount limits.
- AI schema and semantic validation.

Use fixed fixtures with hand-calculated expected values and property tests for invariants such as non-negative forecast quantities and `sum(allocated_discounts) = order_discount`.

### 16.2 Integration tests

- Tenant isolation for every repository and route group.
- Authentication rotation and revoked-session behavior.
- Concurrent sale attempts for the final stock unit.
- Concurrent cash opening attempts.
- Idempotent retries after client timeout.
- Complete sale transaction rollback on any failure.
- Return/cancellation compensation and immutable originals.
- Outbox at-least-once delivery without duplicate analytical effects.
- Migration forward compatibility and constraints.

### 16.3 Contract and end-to-end tests

- Validate OpenAPI request and response examples.
- Exercise the frontend-required flows with admin and employee accounts.
- Verify an employee cannot access dashboard, intelligence, cash administration, closed-session cash history, employees, sales history, or history KPIs.
- Verify an employee can open, view, withdraw from, supply, and close only the assigned current cash session and complete a sale only with that session open.
- Verify an employee cannot retrieve a closed session, historical reconciliation, another register, or another employee's cash movements.
- Verify exports never bypass permissions.
- Replace external AI APIs with recorded contract fixtures in regular CI; run limited provider smoke tests only in a protected environment.

### 16.4 Analytical regression tests

- Freeze representative historical datasets and expected forecast/recommendation outputs by calculation version.
- Recalculate historical runs before publishing a new calculation version and compare differences.
- Keep old runs readable after formula changes.
- Verify the same inputs, configuration, and calculation version produce the same output.

## 17. Deployment and operations

- Environments: local, test/CI, staging, and production.
- Run migrations as a separate controlled deployment step before starting code that requires them.
- Prefer backward-compatible expand/migrate/contract migrations.
- Run at least one API process; it includes the background-job scheduler for the D'lara pilot.
- Use managed PostgreSQL with encrypted backups and point-in-time recovery when available.
- Prevent deployment when migrations, unit tests, integration tests, or API contract validation fail.
- Roll back application code independently; use forward database fixes instead of destructive migration rollback after production data changes.
- Document recovery time and recovery point objectives before production use.

## 18. Configuration

Required configuration groups:

- Database URL and pool limits.
- Access/refresh token keys and durations.
- Allowed frontend origins.
- Tenant default timezone and currency.
- Forecast bucket, training window, horizon, minimum history, backtest window, service level, lead time, review period, and confidence thresholds.
- Promotion thresholds, minimum margin, coefficient `k`, and maximum discount.
- Worker polling, concurrency, retry, and schedule settings.
- AI provider (`gemini` or `anthropic`), exact model ID, API key secret reference, timeout, token limit, temperature, daily budget, and prompt/schema versions.
- Log level, retention, backup, and monitoring destinations.

Business configurations used in a calculation are copied into the immutable run. Editing current settings must not change the meaning of a historical result.

## 19. Implementation plan

### Phase 0: contracts and foundation

- Confirm frontend field mappings and publish the initial OpenAPI contract.
- Create project structure, validation, error model, logging, database connection, migrations, test harness, and CI.
- Implement tenants, settings, users, authentication, sessions, RBAC, tenant isolation, audit events, idempotency, and outbox foundation.

### Phase 1: master data and operational flows

- Implement categories, units, products, price/cost history, customers, employees, suppliers, and assignments.
- Implement purchase orders, goods receipts, inventory balances, movements, stock counts, and daily snapshots.
- Implement cash registers, sessions, employee self-service open/close, and admin movements.
- Implement sales, payments, returns, cancellation, and service orders.
- Replace corresponding frontend mocks incrementally.

### Phase 2: history, dashboard, and exports

- Implement cursor-based history, admin-only KPI endpoints, dashboard metrics, audit review, and permission-safe exports.
- Verify historical snapshots, reversal workflows, completeness flags, and restore procedures.

### Phase 3: deterministic intelligence

- Implement metric snapshots and dataset-quality rules.
- Implement demand/revenue trend, seasonality, intervals, rolling backtests, and baseline comparison.
- Implement inventory turnover, stockout risk, safety stock, reorder point, replenishment, and promotion candidates.
- Publish calculation versions, evidence, confidence, limitations, and admin review workflow.

### Phase 4: AI explanation layer

- Implement the provider-neutral adapter and structured schema.
- Integrate one provider first, validate privacy/cost controls, then implement the second adapter.
- Add semantic/evidence validation, caching, fallback, run history, budgets, and evaluation fixtures.
- Enable production AI only after deterministic analytics and evaluation gates pass.

### Phase 5: hardening

- Complete load, concurrency, tenant-isolation, backup/restore, security, analytical regression, and provider-failure testing.
- Establish monitoring thresholds and operational runbooks.
- Validate that all frontend routes use backend authorization and no production flow depends on mock data.

## 20. Acceptance criteria for backend readiness

- No operational screen requires frontend mock data.
- Every protected response is tenant-scoped and role-checked.
- Employee restrictions and assigned cash-register permissions match the permission matrix.
- Sale, stock, payment, and cash effects commit atomically and are idempotent.
- Material state changes are auditable without storing prohibited secrets.
- Business ledgers and analytical runs remain historically reproducible.
- Forecast and recommendation endpoints expose formulas/versions, data window, completeness, confidence, baseline comparison, and limitations.
- Unknown product costs never appear as zero-margin inputs.
- Stockout periods are not silently treated as zero demand.
- AI is optional, asynchronous, evidence-bound, provider-configurable, and unable to alter operational state.
- A provider outage does not affect sales, cash, inventory, orders, history, or deterministic analytics.
- Backup restoration and critical concurrency tests have passed before production use.

## 21. Official AI provider references

- Gemini models: <https://ai.google.dev/gemini-api/docs/models>
- Gemini structured outputs: <https://ai.google.dev/gemini-api/docs/structured-output>
- Gemini data logging and zero-data-retention guidance: <https://ai.google.dev/gemini-api/docs/zdr>
- Gemini API terms: <https://ai.google.dev/gemini-api/terms>
- Claude models: <https://platform.claude.com/docs/en/about-claude/models/overview>
- Claude model IDs and versions: <https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions>
- Claude structured outputs: <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>
- Anthropic Messages API: <https://platform.claude.com/docs/en/api/messages/create>
- Anthropic API data retention: <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>
- Claude model deprecations: <https://platform.claude.com/docs/en/about-claude/model-deprecations>
