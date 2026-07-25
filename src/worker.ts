import { loadConfig } from "./config/env.js"
import { createDatabase } from "./database/client.js"
import { closeInventoryDailySnapshots } from "./modules/inventory/inventory-snapshot-job.js"

const config = loadConfig()
const database = createDatabase(config)
let stopping = false
let snapshotRunning = false

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

const snapshotTimer = setInterval(() => {
  void runSnapshotClosure()
}, 60_000)

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  clearInterval(snapshotTimer)
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
console.info("Flux worker ready.")
