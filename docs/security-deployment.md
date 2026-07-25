# Security Deployment Baseline

## Secrets and transport

- Store database, JWT, monitoring, Gemini, and Anthropic credentials in the deployment
  secret manager. Do not place them in images, source control, logs, or job payloads.
- Terminate TLS at the trusted ingress and redirect HTTP to HTTPS.
- Set explicit trusted frontend origins. Wildcard CORS is rejected in production.
- Rotate secrets through a controlled deployment and revoke affected sessions.

## PostgreSQL roles

Use separate login roles for migrations, API, worker, and read-only administration:

- Migration role: owns schema changes; unavailable to running applications.
- API role: CRUD only on application tables and sequence usage.
- Worker role: reads domain snapshots and updates jobs, exports, analytics, outbox,
  audit metadata, and AI history.
- Read-only role: `SELECT` only, with no access to authentication token hashes.

Grant permissions to explicit tables. Do not grant superuser, database creation,
role creation, replication, or bypass-RLS privileges to application roles. Review
grants after every migration.

## Runtime controls

- Run the container as the unprivileged Node user.
- Keep the filesystem read-only except for explicitly mounted temporary storage.
- Apply CPU, memory, process, and restart limits at the orchestrator.
- Keep PostgreSQL connection, statement, and idle-transaction timeouts enabled.
- Keep HTTP body and request time limits enabled.
- Restrict the monitoring endpoint with its independent token and network policy.

## Logging and retention

- Logs contain correlation ID, tenant ID, actor ID, route, status, duration, and safe
  error class.
- Authorization headers, cookies, passwords, refresh tokens, and provider keys are
  redacted.
- Diagnostic logs use the configured short retention. Durable audit and business
  ledgers are not removed by log retention.
