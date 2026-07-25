# Implementation Status

Last verified against the frontend and backend working trees on 2026-07-25.

## Delivered

- Authentication, rotating refresh sessions, role authorization, tenant-scoped data
  access, audit records, and idempotent operational mutations.
- Catalog, inventory, customers, employees, cash, sales, returns, service orders,
  history, dashboard, exports, deterministic intelligence, and persisted AI explanation
  flows required by the current D'lara interface.
- Supplier and purchasing backend modules are available for operational integration.
  No supplier-management screen is planned for the D'lara frontend.
- PostgreSQL persistence for operational facts, historical snapshots, analytical runs,
  recommendations, AI runs, reviews, and generated output.
- Deterministic OLS forecasts, intervals, rolling backtests, naive-baseline comparison,
  confidence scoring, unit turnover, stockout risk, replenishment, and promotion
  recommendations.
- Gemini and Anthropic adapters behind an optional, asynchronous AI layer. Production
  AI remains disabled until a provider, credentials, budget, and evaluation policy are
  configured.
- CI validation, PostgreSQL integration coverage for phases 1 through 5, backup and
  restore procedures, monitoring endpoints, and operational runbooks.

## Planned gaps

- `outbox_events` are persisted and monitored, but no integration consumer currently
  claims, delivers, retries, or completes them. This does not block current synchronous
  D'lara flows; it must be completed before an external event-driven integration relies
  on the outbox.
- Tenant isolation and tenant settings exist in the database, but tenant onboarding and
  settings administration do not yet have public HTTP endpoints. D'lara is provisioned
  through the current seed and database configuration.
- Named business-calendar events and measured event-uplift factors are not yet inputs to
  deterministic forecasts.
- Unit-based inventory turnover is available. Cost-based inventory turnover and days
  inventory remain unavailable until complete time-weighted inventory-cost snapshots
  are implemented.
- The frontend has compile, lint, and production-build validation but no automated
  browser or component test suite.
- The sales-history screen and global search currently index the latest 100 sales, and
  the history screen loads individual sale details separately. Larger datasets require
  cursor-based table pagination and remote, debounced search before commercialization.

These gaps must remain explicit in release planning. They must not be represented in
the interface or project reports as delivered behavior.
