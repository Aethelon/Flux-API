# Flux API

Backend for Flux, built as a TypeScript/Fastify modular monolith with PostgreSQL.

## Requirements

- Node.js 22 or newer
- npm
- Docker with Docker Compose, or an existing PostgreSQL instance

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

The API listens on `http://localhost:3333` by default.

- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`
- Login: `POST /api/v1/auth/login`
- Refresh: `POST /api/v1/auth/refresh`
- Current user: `GET /api/v1/auth/me`
- Logout: `POST /api/v1/auth/logout`
- OpenAPI UI: `GET /documentation`

## First D'lara administrator

Set the following values in `.env`:

```text
SEED_ADMIN_NAME=
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

The password must contain at least 12 characters. Then run:

```bash
npm run db:seed:admin
```

The seed is idempotent and does not replace the password of an existing account.

## Commands

```bash
npm run dev
npm run dev:worker
npm run build
npm run typecheck
npm run lint
npm test
npm run db:migrate
npm run db:migrate:down
npm run db:seed:admin
```

Business and infrastructure decisions are documented in [ARCHITECTURE.md](./ARCHITECTURE.md).
