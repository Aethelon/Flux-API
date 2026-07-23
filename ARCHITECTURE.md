# Flux API Architecture

## Authentication and authorization

The API must use role-based access control (RBAC). Authorization is enforced by the API on every protected request; frontend route visibility is only a user-interface safeguard.

Supported roles:

- `admin`: full access to operational and management resources.
- `funcionario`: access only to the operational resources required for daily work.

The authenticated user's role must come from the server-side user record and be included in the signed access token. The API must never accept a role supplied by the request body, query string, or frontend state as authorization evidence.

### Permission matrix

| Resource | `admin` | `funcionario` |
| --- | --- | --- |
| Dashboard data and KPIs | Allowed | Denied |
| Intelligence, analytics, and forecasts | Allowed | Denied |
| Cash register opening, closing, withdrawals, supplies, and reconciliation | Allowed | Denied |
| Employee management | Allowed | Denied |
| Sales history records | Allowed | Allowed |
| Sales history KPIs and revenue aggregates | Allowed | Denied |
| Point of sale | Allowed | Allowed, using an already-open cash register session |
| Orders, inventory, and clients | Allowed | Allowed |

### Endpoint requirements

Endpoints that expose dashboard data, intelligence data, cash register management, employee management, or sales history KPIs must require the `admin` role. This includes future endpoints under resource groups such as:

- `/dashboard`
- `/intelligence`
- `/cash-registers`
- `/employees`
- `/history/kpis`

The sales history listing endpoint may be used by `funcionario`, but its response must not include KPI, revenue-total, trend, margin, or aggregate fields. Aggregate data must be returned by a separate admin-only endpoint.

The point of sale may expose a read-only cash-register status to `funcionario` containing only whether a register session is open. Cash balances, movements, reconciliation data, and management actions remain admin-only.

An authenticated user without the required role receives `403 Forbidden`. Missing, invalid, or expired authentication receives `401 Unauthorized`.

All queries must also be scoped to the authenticated user's company or tenant. Role checks do not replace tenant isolation.
