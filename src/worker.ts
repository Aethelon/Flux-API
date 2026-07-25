import { loadConfig } from "./config/env.js"
import { createDatabase } from "./database/client.js"
import { closeInventoryDailySnapshots } from "./modules/inventory/inventory-snapshot-job.js"
import {
  cleanupExpiredExports,
  processPendingExports,
} from "./modules/exports/export-job.js"
import { processPendingAnalytics } from "./modules/intelligence/analytics-job.js"

const config = loadConfig()
const database = createDatabase(config)
let stopping = false
let snapshotRunning = false
let exportRunning = false
let analyticsRunning = false

async function runSnapshotClosure(): Promise<void> {
  if (snapshotRunning || stopping) return
  snapshotRunning = true
  try {
    const closed = await closeInventoryDailySnapshots(database)
    if (closed > 0) {
      console.info(`Closed ${String(closed)} inventory daily snapshots.`)
    }
  } catch (error) {
    console.error("Inventory snapshot closure failed.", error)
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
      console.info(`Processed ${String(processed)} export jobs.`)
    }
    await cleanupExpiredExports(database)
  } catch (error) {
    console.error("Export processing failed.", error)
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
      console.info(`Processed ${String(processed)} analytics jobs.`)
    }
  } catch (error) {
    console.error("Analytics processing failed.", error)
  } finally {
    analyticsRunning = false
  }
}

const snapshotTimer = setInterval(() => {
  void runSnapshotClosure()
}, 60_000)

const exportTimer = setInterval(() => {
  void runExports()
}, 5_000)

const analyticsTimer = setInterval(() => {
  void runAnalytics()
}, 5_000)

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  clearInterval(snapshotTimer)
  clearInterval(exportTimer)
  clearInterval(analyticsTimer)
  console.info(`Flux worker stopping after ${signal}.`)
  await database.destroy()
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
})

process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
})

void runSnapshotClosure()
void runExports()
void runAnalytics()
console.info("Flux worker ready.")
