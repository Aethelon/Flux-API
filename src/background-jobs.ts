import type { FastifyBaseLogger } from "fastify"
import type { Kysely } from "kysely"
import type { AppConfig } from "./config/env.js"
import type { Database } from "./database/types.js"
import { processPendingAi } from "./modules/ai/ai-job.js"
import { createAiProvider } from "./modules/ai/providers.js"
import {
  cleanupExpiredExports,
  processPendingExports,
} from "./modules/exports/export-job.js"
import { processPendingAnalytics } from "./modules/intelligence/analytics-job.js"
import { closeInventoryDailySnapshots } from "./modules/inventory/inventory-snapshot-job.js"
import { runHousekeeping } from "./shared/persistence/housekeeping-job.js"

export interface BackgroundJobs {
  stop: () => Promise<void>
}

export function startBackgroundJobs(
  database: Kysely<Database>,
  config: AppConfig,
  logger: FastifyBaseLogger,
): BackgroundJobs {
  const aiProvider = createAiProvider(config)
  const activeRuns = new Set<Promise<void>>()
  let stopping = false
  let snapshotRunning = false
  let exportRunning = false
  let analyticsRunning = false
  let aiRunning = false
  let housekeepingRunning = false

  async function runSnapshotClosure(): Promise<void> {
    if (snapshotRunning || stopping) return
    snapshotRunning = true
    try {
      const closed = await closeInventoryDailySnapshots(database)
      if (closed > 0) {
        logger.info({ closed }, "Closed inventory daily snapshots")
      }
    } catch (error) {
      logger.error({ err: error }, "Inventory snapshot closure failed")
    } finally {
      snapshotRunning = false
    }
  }

  async function runExports(): Promise<void> {
    if (exportRunning || stopping) return
    exportRunning = true
    try {
      const processed = await processPendingExports(database)
      if (processed > 0) {
        logger.info({ processed }, "Processed export jobs")
      }
      await cleanupExpiredExports(database)
    } catch (error) {
      logger.error({ err: error }, "Export processing failed")
    } finally {
      exportRunning = false
    }
  }

  async function runAnalytics(): Promise<void> {
    if (analyticsRunning || stopping) return
    analyticsRunning = true
    try {
      const processed = await processPendingAnalytics(database)
      if (processed > 0) {
        logger.info({ processed }, "Processed analytics jobs")
      }
    } catch (error) {
      logger.error({ err: error }, "Analytics processing failed")
    } finally {
      analyticsRunning = false
    }
  }

  async function runAi(): Promise<void> {
    if (aiRunning || stopping) return
    aiRunning = true
    try {
      const processed = await processPendingAi(database, config, 2, aiProvider)
      if (processed > 0) {
        logger.info({ processed }, "Processed AI jobs")
      }
    } catch (error) {
      logger.error({ err: error }, "AI insight processing failed")
    } finally {
      aiRunning = false
    }
  }

  async function runMaintenance(): Promise<void> {
    if (housekeepingRunning || stopping) return
    housekeepingRunning = true
    try {
      const result = await runHousekeeping(database, config)
      const removed = result.idempotencyRecords
        + result.outboxEvents
        + result.authSessions
      if (removed > 0) {
        logger.info({ removed }, "Removed expired infrastructure records")
      }
    } catch (error) {
      logger.error({ err: error }, "Infrastructure housekeeping failed")
    } finally {
      housekeepingRunning = false
    }
  }

  function schedule(operation: () => Promise<void>): void {
    const run = operation()
    activeRuns.add(run)
    void run.then(
      () => activeRuns.delete(run),
      () => activeRuns.delete(run),
    )
  }

  const timers = [
    setInterval(() => schedule(runSnapshotClosure), 60_000),
    setInterval(() => schedule(runExports), 5_000),
    setInterval(() => schedule(runAnalytics), 5_000),
    setInterval(() => schedule(runAi), 5_000),
    setInterval(() => schedule(runMaintenance), 60 * 60 * 1_000),
  ]

  schedule(runSnapshotClosure)
  schedule(runExports)
  schedule(runAnalytics)
  schedule(runAi)
  schedule(runMaintenance)
  logger.info("Embedded background jobs started")

  return {
    async stop(): Promise<void> {
      if (!stopping) {
        stopping = true
        for (const timer of timers) clearInterval(timer)
      }
      await Promise.allSettled([...activeRuns])
      logger.info("Embedded background jobs stopped")
    },
  }
}
