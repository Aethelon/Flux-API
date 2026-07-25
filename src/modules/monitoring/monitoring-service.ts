import { sql, type Kysely } from "kysely"
import type { AppConfig } from "../../config/env.js"
import type { Database } from "../../database/types.js"

interface HttpMetric {
  route: string
  status: number
  count: number
  durationMs: number
}

function label(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\"", "\\\"")
}

function metric(
  name: string,
  value: string | number,
  labels: Record<string, string> = {},
): string {
  const renderedLabels = Object.entries(labels)
    .map(([key, item]) => `${key}="${label(item)}"`).join(",")
  return `${name}${renderedLabels ? `{${renderedLabels}}` : ""} ${String(value)}`
}

export class MonitoringService {
  private readonly http = new Map<string, HttpMetric>()
  private readonly errors = new Map<string, number>()

  constructor(
    private readonly database: Kysely<Database>,
    private readonly config: AppConfig,
  ) {}

  observeHttp(
    route: string,
    status: number,
    durationMs: number,
    errorClass: string | null,
  ): void {
    const key = `${route}:${String(status)}`
    const current = this.http.get(key) ?? {
      route,
      status,
      count: 0,
      durationMs: 0,
    }
    current.count += 1
    current.durationMs += durationMs
    this.http.set(key, current)
    if (errorClass) {
      this.errors.set(errorClass, (this.errors.get(errorClass) ?? 0) + 1)
    }
  }

  async renderPrometheus(): Promise<string> {
    const now = new Date()
    const jobStaleAt = new Date(
      now.getTime() - (this.config.monitoringJobStaleMinutes * 60_000),
    )
    const outboxStaleAt = new Date(
      now.getTime() - (this.config.monitoringOutboxStaleMinutes * 60_000),
    )
    const dayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1_000))
    const operational = await this.database.selectNoFrom([
      sql<string>`(
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database()
      )`.as("database_connections"),
      sql<string>`(
        SELECT count(*) FROM job_runs
        WHERE status = 'processing' AND started_at < ${jobStaleAt}
      )`.as("stale_jobs"),
      sql<string>`(
        SELECT count(*) FROM outbox_events
        WHERE status IN ('pending', 'failed') AND created_at < ${outboxStaleAt}
      )`.as("stale_outbox"),
      sql<string>`coalesce((
        SELECT extract(epoch FROM (now() - min(created_at)))
        FROM outbox_events WHERE status IN ('pending', 'failed')
      ), 0)`.as("outbox_lag_seconds"),
      sql<string>`coalesce((
        SELECT extract(epoch FROM (now() - max(created_at)))
        FROM forecast_runs WHERE published = true
      ), -1)`.as("forecast_age_seconds"),
      sql<string>`coalesce((
        SELECT avg(NULLIF(completeness ->> 'coverage', '')::numeric)
        FROM metric_snapshots
        WHERE published = true
          AND completeness ? 'coverage'
      ), 0)`.as("data_completeness"),
      sql<string>`coalesce((
        SELECT sum(estimated_cost_micro_usd)
        FROM ai_runs WHERE created_at >= ${dayAgo}
      ), 0)`.as("ai_cost"),
      sql<string>`coalesce((
        SELECT sum(input_tokens + output_tokens)
        FROM ai_runs WHERE created_at >= ${dayAgo}
      ), 0)`.as("ai_tokens"),
      sql<string>`coalesce((
        SELECT count(*) FILTER (WHERE status = 'failed')::numeric
          / NULLIF(count(*), 0)
        FROM ai_runs WHERE created_at >= ${dayAgo}
      ), 0)`.as("ai_error_rate"),
      sql<string>`coalesce((
        SELECT extract(epoch FROM (now() - created_at))
        FROM backup_restore_checks
        WHERE status = 'passed'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ), -1)`.as("backup_age_seconds"),
      sql<string>`coalesce((
        SELECT CASE WHEN status = 'failed' THEN 1 ELSE 0 END
        FROM backup_restore_checks
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ), 1)`.as("last_backup_failed"),
      sql<string>`(
        SELECT count(*) FROM inventory_balances
        WHERE on_hand < 0 OR reserved < 0 OR reserved > on_hand
      )`.as("inventory_invariant_violations"),
      sql<string>`coalesce((
        SELECT avg(latency_ms) FROM ai_runs
        WHERE created_at >= ${dayAgo} AND latency_ms > 0
      ), 0)`.as("ai_latency"),
    ]).executeTakeFirstOrThrow()
    const jobs = await this.database.selectFrom("job_runs").select([
      "job_type",
      sql<string>`count(*) FILTER (WHERE status = 'failed')`.as("failed"),
      sql<string>`coalesce(avg(
        extract(epoch FROM (finished_at - started_at)) * 1000
      ) FILTER (
        WHERE status = 'completed'
          AND started_at IS NOT NULL
          AND finished_at IS NOT NULL
      ), 0)`.as("duration_ms"),
    ]).where("created_at", ">=", dayAgo)
      .groupBy("job_type").orderBy("job_type").execute()
    const lines = [
      "# TYPE flux_http_requests_total counter",
      "# TYPE flux_http_request_duration_milliseconds_total counter",
    ]
    for (const item of [...this.http.values()].sort((left, right) =>
      `${left.route}:${String(left.status)}`.localeCompare(
        `${right.route}:${String(right.status)}`,
      )
    )) {
      const labels = { route: item.route, status: String(item.status) }
      lines.push(metric("flux_http_requests_total", item.count, labels))
      lines.push(metric(
        "flux_http_request_duration_milliseconds_total",
        item.durationMs,
        labels,
      ))
    }
    lines.push("# TYPE flux_http_errors_total counter")
    for (const [errorClass, count] of [...this.errors.entries()].sort()) {
      lines.push(metric("flux_http_errors_total", count, { error_class: errorClass }))
    }
    const values = {
      databaseConnections: Number(operational.database_connections),
      staleJobs: Number(operational.stale_jobs),
      staleOutbox: Number(operational.stale_outbox),
      outboxLagSeconds: Number(operational.outbox_lag_seconds),
      forecastAgeSeconds: Number(operational.forecast_age_seconds),
      dataCompleteness: Number(operational.data_completeness),
      aiCost: Number(operational.ai_cost),
      aiTokens: Number(operational.ai_tokens),
      aiErrorRate: Number(operational.ai_error_rate),
      backupAgeSeconds: Number(operational.backup_age_seconds),
      lastBackupFailed: Number(operational.last_backup_failed),
      inventoryInvariantViolations: Number(
        operational.inventory_invariant_violations,
      ),
      aiLatency: Number(operational.ai_latency),
    }
    lines.push(metric("flux_database_connections", values.databaseConnections))
    lines.push(metric("flux_outbox_lag_seconds", values.outboxLagSeconds))
    lines.push(metric("flux_jobs_stale", values.staleJobs))
    lines.push(metric("flux_outbox_events_stale", values.staleOutbox))
    lines.push(metric("flux_forecast_age_seconds", values.forecastAgeSeconds))
    lines.push(metric("flux_data_completeness_ratio", values.dataCompleteness))
    lines.push(metric("flux_ai_tokens_24h", values.aiTokens))
    lines.push(metric("flux_ai_cost_micro_usd_24h", values.aiCost))
    lines.push(metric("flux_ai_provider_error_ratio_24h", values.aiErrorRate))
    lines.push(metric("flux_ai_latency_milliseconds_24h", values.aiLatency))
    lines.push(metric("flux_backup_age_seconds", values.backupAgeSeconds))
    for (const job of jobs) {
      lines.push(metric(
        "flux_job_failures_24h",
        Number(job.failed),
        { job_type: job.job_type },
      ))
      lines.push(metric(
        "flux_job_duration_milliseconds_24h",
        Number(job.duration_ms),
        { job_type: job.job_type },
      ))
    }
    lines.push(metric(
      "flux_alert",
      values.staleJobs > 0 ? 1 : 0,
      { type: "overdue_jobs" },
    ))
    lines.push(metric(
      "flux_alert",
      values.staleOutbox > 0 ? 1 : 0,
      { type: "stuck_outbox" },
    ))
    lines.push(metric(
      "flux_alert",
      values.forecastAgeSeconds >= this.config.monitoringForecastStaleHours * 3_600
        ? 1 : 0,
      { type: "stale_forecasts" },
    ))
    lines.push(metric(
      "flux_alert",
      values.lastBackupFailed === 1
        || values.backupAgeSeconds < 0
        || values.backupAgeSeconds
          >= this.config.monitoringBackupStaleHours * 3_600
        ? 1 : 0,
      { type: "backup" },
    ))
    lines.push(metric(
      "flux_alert",
      values.aiCost >= this.config.monitoringAiCostAlertMicroUsd ? 1 : 0,
      { type: "ai_spend" },
    ))
    lines.push(metric(
      "flux_alert",
      values.inventoryInvariantViolations > 0 ? 1 : 0,
      { type: "negative_stock_invariant" },
    ))
    lines.push(metric(
      "flux_build_info",
      1,
      { calculation_version: "analytics-v1" },
    ))
    return `${lines.join("\n")}\n`
  }
}
