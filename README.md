# Flux API

Flux API is the transactional and analytical backend for Flux, a retail and production
management platform for businesses that combine product sales, services, and customized
orders.

It is implemented as a TypeScript modular monolith with Fastify and PostgreSQL. The API
owns authentication, authorization, tenant isolation, business rules, financial and
inventory consistency, historical persistence, deterministic analytics, and the
boundaries around optional AI explanations.

The current release supports the D'lara pilot. The data model and authorization context
are tenant-aware, while commercial tenant onboarding and settings administration remain
planned work.

## Architecture

```mermaid
flowchart LR
    C["Flux App or API client"] --> H["Fastify HTTP API"]
    H --> M["Domain modules"]
    M --> K["Kysely repositories"]
    K --> DB[("PostgreSQL")]
    M --> Q["Persisted job records"]
    H --> B["Embedded background jobs"]
    B --> Q
    B --> DB
    B --> D["Deterministic analytics"]
    B --> P["Gemini or Anthropic"]
```

The application is intentionally a modular monolith:

- one transactional PostgreSQL database protects sale, stock, payment, cash, and
  service-order consistency;
- domain modules own their routes, validation, services, and repository boundaries;
- the API process handles synchronous requests and embedded background jobs;
- background jobs process exports, analytics, AI, inventory snapshots, and retention
  housekeeping without requiring a separate service for the D'lara pilot;
- TypeBox route schemas drive validation and OpenAPI documentation;
- asynchronous work is persisted before processing and can be reviewed after restart.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete business rules, persistence
model, formulas, permission matrix, and target architecture.

## Core design guarantees

- **Server authority:** the API, not the browser or an AI model, decides permissions,
  money, inventory, cash totals, KPIs, forecasts, and recommendations.
- **Tenant isolation:** authenticated users carry a server-verified tenant context, and
  repository queries scope business data by tenant.
- **Role authorization:** administrator-only resources are enforced by route and
  service boundaries.
- **Atomic operations:** sales commit their items, payments, stock effects,
  service-order billing, and cash effects in one database transaction.
- **Idempotency:** public state-changing business operations require an
  `Idempotency-Key` and persist replay metadata.
- **Optimistic concurrency:** versioned entities reject stale updates.
- **Historical integrity:** sale snapshots, cost and price histories, stock movements,
  status transitions, audit events, forecasts, recommendations, AI runs, and reviews
  remain persisted.
- **AI isolation:** provider failure cannot block sales, cash, inventory, history, or
  deterministic analytics.

## Modules

| Module | Responsibility |
| --- | --- |
| `auth` | Login, access JWTs, rotating refresh sessions, current user, logout, session revocation, and login auditing |
| `catalog` | Categories, measurement units, products and services, price history, cost history, decimal quantity rules, and archive constraints |
| `inventory` | Balances, reservations, stock movements, weighted-average cost, stock counts, reversals, and daily inventory snapshots |
| `people` | Customer and employee lifecycle, roles, credentials, status, tenant-safe lookup, and archive rules |
| `cash` | Registers, employee assignments, sessions, opening, supplies, withdrawals, closing, reconciliation, and administrator history |
| `sales` | Atomic sales, item and payment snapshots, discounts, change, stock consumption, cancellation, and returns |
| `service-orders` | Workflow columns, orders, board ordering, transitions, cancellation, billing state, and status history |
| `history` | Cursor-based sale history, permission-safe records, timezone-aware reporting, and administrator KPIs |
| `dashboard` | Persisted operational and management aggregates for the administrator dashboard |
| `intelligence` | Deterministic forecast and recommendation jobs, evidence, backtests, confidence, review state, and calculation versions |
| `ai` | Gemini and Anthropic adapters, structured output, semantic validation, cost controls, caching, persistence, and human review |
| `exports` | Asynchronous CSV generation, persisted artifacts, integrity hashes, expiration, and permission-safe download |
| `audit` | Tenant-scoped review of material state changes with sensitive-value redaction |
| `monitoring` | Protected Prometheus metrics for HTTP traffic, jobs, outbox age, forecasts, AI cost, and backup freshness |
| `health` | Database-independent liveness and database-backed readiness checks |

## Permissions

| Capability | Administrator | Employee |
| --- | --- | --- |
| Dashboard and intelligence | Allowed | Denied |
| Employee management | Allowed | Denied |
| Cash-register administration and closed-session history | Allowed | Denied |
| Assigned cash session, supply, withdrawal, and close | Allowed | Allowed for own assigned register |
| Point of sale | Allowed | Allowed |
| Service orders, inventory, and customers | Allowed | Allowed |
| Sales-history records and own exports | Allowed | Allowed |
| Historical KPIs and revenue aggregates | Allowed | Denied |
| Recommendation and AI review | Allowed | Denied |

Frontend route visibility is only a usability control. API authorization is the
security boundary.

## API surface

All business routes use the `/api/v1` prefix.

| Group | Main paths |
| --- | --- |
| Authentication | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/logout` |
| Catalog | `/categories`, `/units`, `/products` |
| Inventory | `/inventory/balances`, `/inventory/movements`, `/inventory/stock-counts` |
| People | `/customers`, `/employees` |
| Cash | `/cash-registers`, `/cash-register-assignments`, `/cash-sessions` |
| Sales | `/sales`, `/sales/:id/returns`, `/sales/:id/cancel` |
| Service orders | `/service-order-columns`, `/service-orders` |
| History and dashboard | `/history/sales`, `/history/kpis`, `/dashboard` |
| Intelligence and AI | `/intelligence/forecasts`, `/intelligence/recommendations`, `/intelligence/insights` |
| Audit and exports | `/audit-events`, `/exports`, `/jobs` |
| Operations | `/health/live`, `/health/ready`, `/monitoring/metrics` |

Interactive OpenAPI documentation is available at
[http://localhost:3333/documentation](http://localhost:3333/documentation) while the
API is running.

Errors use a stable shape:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request contains invalid fields.",
  "requestId": "correlation-id"
}
```

Validation errors may also include `fieldErrors`; domain errors may include `details`.

## Technology

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 22+ |
| Language | TypeScript |
| HTTP | Fastify 5 |
| Validation and OpenAPI | TypeBox and Fastify Swagger |
| Database | PostgreSQL 17 |
| Query layer | Kysely |
| Authentication | jose JWT and scrypt password hashing |
| Tests | Node.js test runner through tsx |
| Local infrastructure | Docker Compose |

## Getting started

### Requirements

- Node.js 22 or newer
- npm
- Docker with Docker Compose, or an existing PostgreSQL instance

### Installation

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
```

Start the API:

```bash
npm run dev
```

The API and its embedded background jobs start together. The API listens on
[http://localhost:3333](http://localhost:3333) by default.

### First D'lara administrator

Set the following variables in `.env`:

```text
SEED_ADMIN_NAME=
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

The password must contain between 8 and 128 characters. Then run:

```bash
npm run db:seed:admin
```

The seed is idempotent and does not replace the password of an existing account.

### Local demonstration data

The non-production demonstration seed adds realistic D'lara users, catalog records,
inventory history, customers, cash sessions, sales, service orders, forecasts, and
recommendations without deleting existing data:

```bash
SEED_DEMO_PASSWORD="<at-least-8-characters>" npm run db:seed:demo
```

The seed is idempotent, refuses to run with `NODE_ENV=production`, and refreshes only
the dedicated demonstration-user passwords when executed again.

To complement an existing D'lara database with twelve months of manual inventory
entries, current-month sales, historical service orders, daily inventory observations,
and regenerated forecasts and recommendations, run:

```bash
npm run db:seed:demo-history
```

This complementary seed is also idempotent, refuses production execution, and does
not change user credentials.

## Configuration

`.env.example` is the authoritative local template.

### Runtime and HTTP

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `HOST`, `PORT` | HTTP bind address and port |
| `LOG_LEVEL` | Structured Fastify log level |
| `CORS_ORIGINS` | Comma-separated trusted frontend origins |
| `HTTP_BODY_LIMIT_BYTES` | Maximum request body size |
| `HTTP_REQUEST_TIMEOUT_MS` | HTTP request timeout |

### Database

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_POOL_MAX` | Maximum connection pool size |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Connection acquisition timeout |
| `DATABASE_STATEMENT_TIMEOUT_MS` | PostgreSQL statement timeout |
| `DATABASE_IDLE_TRANSACTION_TIMEOUT_MS` | Idle transaction timeout |

### Authentication

| Variable | Purpose |
| --- | --- |
| `JWT_ACCESS_SECRET` | Access-token signing secret, minimum 32 characters |
| `JWT_ACCESS_TTL_SECONDS` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | Rotating refresh-session lifetime |

The frontend `JWT_SECRET` must contain the same value as `JWT_ACCESS_SECRET`.

### Monitoring and retention

| Variable group | Purpose |
| --- | --- |
| `MONITORING_TOKEN` | Bearer token for `/api/v1/monitoring/metrics`; required and at least 32 characters in production |
| `MONITORING_*` | Stale-job, outbox, forecast, backup, and AI-cost thresholds |
| `LOG_RETENTION_DAYS` | Retention target for the deployment logging policy |
| `OUTBOX_RETENTION_DAYS` | Completed outbox retention |
| `AUTH_SESSION_RETENTION_DAYS` | Revoked and expired session retention |
| `BACKUP_RPO_HOURS`, `BACKUP_RTO_MINUTES` | Recovery objectives used by monitoring and operations |

### AI

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `disabled`, `gemini`, or `anthropic` |
| `GEMINI_API_KEY`, `GEMINI_MODEL_ID` | Gemini credentials and pinned model |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_ID` | Anthropic credentials and pinned model |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | Provider resilience limits |
| `AI_MAX_OUTPUT_TOKENS`, `AI_TEMPERATURE` | Output controls |
| `AI_CACHE_TTL_HOURS` | Reuse window for equivalent validated inputs |
| `AI_PROMPT_VERSION`, `AI_SCHEMA_VERSION`, `AI_POLICY_VERSION` | Reproducibility metadata |

AI is disabled by default. Deterministic analytics remain available without an AI
provider.

## Database lifecycle

Apply pending migrations:

```bash
npm run db:migrate
```

Revert only the latest migration during local development:

```bash
npm run db:migrate:down
```

Production deployments must apply forward migrations before starting new application
instances. Do not use destructive rollback after production data changes.

Backup, restore, RPO, and RTO procedures are documented in
[docs/backup-restore.md](./docs/backup-restore.md).

## Background job responsibilities

The API process also runs the persisted background-job scheduler, which performs:

- inventory daily-snapshot closure;
- pending export generation and artifact cleanup;
- deterministic analytics jobs;
- AI explanation jobs when a provider is enabled;
- expired idempotency, outbox, and authentication-session housekeeping.

For the D'lara pilot, one API process is sufficient. Job state remains in PostgreSQL,
so a separate process can be introduced later if measured load requires it.

`outbox_events` are currently persisted and monitored, but no external integration
consumer claims or delivers them yet. See
[implementation status](./docs/implementation-status.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and background jobs with file watching |
| `npm run build` | Compile production JavaScript into `dist/` |
| `npm start` | Start the compiled API and background jobs |
| `npm run typecheck` | Validate TypeScript without emitting files |
| `npm run lint` | Run ESLint |
| `npm test` | Run the regular test suite |
| `npm run check` | Run typecheck, lint, tests, and build |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:down` | Revert the latest migration |
| `npm run db:seed:admin` | Create the first tenant administrator |
| `npm run db:seed:demo` | Add idempotent local demonstration data to D'lara |
| `npm run db:seed:demo-history` | Add historical purchases, current sales, service orders, and analytical observations to D'lara |

## Testing

The default quality gate is:

```bash
npm run check
npm audit --omit=dev
```

PostgreSQL integration suites are opt-in locally and enabled in CI:

```bash
RUN_PHASE_ONE_INTEGRATION=1 \
RUN_PHASE_TWO_INTEGRATION=1 \
RUN_PHASE_THREE_INTEGRATION=1 \
RUN_PHASE_FOUR_INTEGRATION=1 \
RUN_PHASE_FIVE_INTEGRATION=1 \
DATABASE_URL=postgres://flux:flux@127.0.0.1:5432/flux \
npm test
```

The integration suites cover role and tenant boundaries, idempotency, concurrency,
overselling prevention, operational transactions, history, analytics, AI persistence,
exports, monitoring, and provider failure isolation.

## Project structure

```text
src/
├── app.ts                     Fastify composition and global plugins
├── background-jobs.ts         Embedded persisted-job scheduler
├── server.ts                  API and background-job process entry point
├── config/
│   └── env.ts                 Validated runtime configuration
├── database/
│   ├── client.ts              PostgreSQL and Kysely setup
│   ├── migrations/            Versioned schema migrations
│   ├── seeds/                 Controlled bootstrap data
│   └── types.ts               Typed database model
├── modules/
│   ├── auth/
│   ├── catalog/
│   ├── inventory/
│   ├── people/
│   ├── cash/
│   ├── sales/
│   ├── service-orders/
│   ├── history/
│   ├── dashboard/
│   ├── intelligence/
│   ├── ai/
│   ├── exports/
│   ├── audit/
│   ├── monitoring/
│   └── health/
└── shared/
    ├── auth/                  Shared authorization helpers
    ├── errors/                Stable domain and HTTP errors
    ├── http/                  Shared schemas and request contracts
    ├── observability/         Correlation and request context
    └── persistence/           Idempotency, outbox, and housekeeping
```

Within a domain module, routes define HTTP contracts, services enforce business rules,
repositories own database access, and schemas define validated request and response
shapes.

## Production considerations

- Use explicit trusted CORS origins; wildcard origins are rejected in production.
- Store database, JWT, monitoring, and AI credentials in a secret manager.
- Run migrations as a controlled deployment step.
- Run at least one API process, which includes the background-job scheduler.
- Protect the monitoring endpoint with its dedicated bearer token.
- Enable automated PostgreSQL backups and verify restoration regularly.
- Keep AI optional and use only aggregated, non-personal analytical inputs.
- Review the security and operations runbooks before production deployment.

The included multi-stage `Dockerfile` builds a non-root Node.js runtime image. The
Compose file starts the local PostgreSQL dependency.

## Documentation

- [Architecture and business rules](./ARCHITECTURE.md)
- [Verified implementation status](./docs/implementation-status.md)
- [Frontend readiness](./docs/frontend-readiness.md)
- [Operations runbook](./docs/operations-runbook.md)
- [Security deployment guide](./docs/security-deployment.md)
- [Backup and restore guide](./docs/backup-restore.md)
- [Flux App overview](../Flux-App/README.md)

## Current planned gaps

The current implementation status is tracked separately to prevent target architecture
from being confused with delivered behavior. Known planned items include:

- an external outbox consumer;
- public tenant onboarding and tenant-settings administration;
- named business-calendar uplift in forecasts;
- cost-based inventory turnover;
- scalable remote pagination and search for larger frontend history datasets.

See [docs/implementation-status.md](./docs/implementation-status.md) for the verified
details.
