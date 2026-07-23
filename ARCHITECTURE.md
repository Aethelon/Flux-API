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
| Open and close the user's assigned cash register | Allowed | Allowed |
| Cash register withdrawals, supplies, balances, history, and reconciliation | Allowed | Denied |
| Employee management | Allowed | Denied |
| Sales history records | Allowed | Allowed |
| Sales history KPIs and revenue aggregates | Allowed | Denied |
| Point of sale | Allowed | Allowed, using the user's assigned cash register session |
| Orders, inventory, and clients | Allowed | Allowed |

### Endpoint requirements

Endpoints that expose dashboard data, intelligence data, cash register administration, employee management, or sales history KPIs must require the `admin` role. This includes future endpoints under resource groups such as:

- `/dashboard`
- `/intelligence`
- `/cash-registers`
- `/employees`
- `/history/kpis`

Employee-scoped cash-register operations must use the authenticated user rather than an employee ID supplied by the client:

- `GET /cash-registers/me`: returns only the status of the assigned register session.
- `POST /cash-registers/me/open`: opens the assigned register for the authenticated user.
- `POST /cash-registers/me/close`: closes the authenticated user's active assigned register session.

The sales history listing endpoint may be used by `funcionario`, but its response must not include KPI, revenue-total, trend, margin, or aggregate fields. Aggregate data must be returned by a separate admin-only endpoint.

The point of sale may expose a read-only cash-register status to `funcionario` containing only whether the user's assigned register session is open.

A `funcionario` may open a cash-register session only for the register assigned to their authenticated user and may close only that same active session. The API derives the employee identity from the access token and the register assignment from server-side data. A request must not choose or override another employee ID. Cash balances, movements, withdrawals, supplies, history, and reconciliation data remain admin-only.

An authenticated user without the required role receives `403 Forbidden`. Missing, invalid, or expired authentication receives `401 Unauthorized`.

All queries must also be scoped to the authenticated user's company or tenant. Role checks do not replace tenant isolation.
