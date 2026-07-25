# Frontend Backend-Readiness Validation

This validation tracks the Phase 5 requirement that production routes use backend
authorization and do not depend on local business-data mocks.

## Integrated flows

- Login, current-user lookup, token refresh, and logout use `/api/v1/auth`.
- Access and refresh tokens remain in HTTP-only cookies behind the frontend proxy.
- Customer and employee list/create/update/archive flows use the API.
- Categories, units, products, and inventory balances/movements use the API.
- Service-order columns, service orders, transitions, cancellation, and board ordering
  use the API.
- Point-of-sale completion uses the atomic sales endpoint and server-issued business
  numbers.
- Assigned cash-session opening, supplies, withdrawals, closing, reconciliation, and
  administrator history use the API.
- Sales history, individual sale snapshots, administrator KPIs, and CSV export use the
  API.
- Dashboard metrics, deterministic forecasts, recommendations, and persisted AI
  explanations use the API.
- Global search indexes API-backed catalog, customers, service orders, and sales
  history.
- Frontend route visibility remains a usability control; the API remains the
  authorization boundary.

## Production-flow result

No operational frontend route depends on local business-data fixtures or browser
persistence. Backend-calculated money, cash totals, KPIs, forecasts, recommendations,
and AI explanations are rendered without client-side replacement values.

Frontend preferences such as theme, font size, and sidebar state are local UI state and
are not business-data blockers.

The frontend mock-removal criterion is met. Backend integration, role authorization,
transactional, concurrency, and regression tests remain the authoritative automated
validation for the corresponding contracts.
