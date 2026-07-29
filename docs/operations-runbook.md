# Flux Operations Runbook

## Service objectives

- Recovery point objective: 24 hours or the configured `BACKUP_RPO_HOURS`.
- Recovery time objective: 60 minutes or the configured `BACKUP_RTO_MINUTES`.
- API readiness requires a successful PostgreSQL query.
- Production requires at least one API process, which includes background jobs.

## Health and metrics

- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`
- Prometheus metrics: `GET /api/v1/monitoring/metrics`
- The metrics endpoint requires `Authorization: Bearer <MONITORING_TOKEN>`.

Alert when `flux_alert` is `1`. Defined alert types:

- `overdue_jobs`: a job remained processing beyond the configured threshold.
- `stuck_outbox`: an outbox event remained pending or failed beyond the threshold.
- `stale_forecasts`: the newest published forecast exceeded the freshness threshold.
- `backup`: no successful restore check exists, the latest check failed, or it is stale.
- `ai_spend`: 24-hour estimated AI cost reached the configured threshold.
- `negative_stock_invariant`: a persisted balance violates the non-negative or
  reservation invariant.

## Incident response

1. Record the start time, environment, request/correlation IDs, and active deployment.
2. Check liveness, readiness, PostgreSQL availability, background-job logs, and
   `flux_alert`.
3. Do not edit immutable sales, stock movements, cash movements, audit events, or
   analytical runs directly.
4. Disable the affected optional subsystem when possible. AI can be disabled with
   `AI_PROVIDER=disabled` without affecting deterministic or operational flows.
5. For a stuck job, diagnose its safe error class and dependency before retrying.
   Do not manually mark it completed.
6. For stock or financial inconsistencies, stop the affected write flow and preserve
   all evidence. Use domain reversal operations rather than direct data edits.
7. Record recovery time, cause, affected tenants, and corrective action.

## Backup verification

Run `scripts/verify-backup-restore.sh` against the source and a separate empty target:

```sh
SOURCE_DATABASE_URL="..." RESTORE_DATABASE_URL="..." \
  scripts/verify-backup-restore.sh
```

The script refuses to restore into the source or a non-empty target. It records the
schema comparison, critical table counts, duration, and result in
`backup_restore_checks`.

## Deployment

1. Build and test the exact commit.
2. Back up the database and confirm a recent successful restore verification.
3. Apply migrations as a separate controlled step.
4. Deploy the API; its background-job scheduler starts in the same process.
5. Verify liveness, readiness, metrics, authentication, and one read-only tenant flow.
6. Roll application code back independently if needed. After production data changes,
   use forward database fixes instead of destructive migration rollback.
