import { buildApp } from "./app.js"
import {
  startBackgroundJobs,
  type BackgroundJobs,
} from "./background-jobs.js"

const app = buildApp()
let backgroundJobs: BackgroundJobs | null = null
let stopping = false

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  app.log.info({ signal }, "Shutting down API")
  await backgroundJobs?.stop()
  await app.close()
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
})

process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
})

try {
  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })
  backgroundJobs = startBackgroundJobs(app.db, app.config, app.log)
  app.log.info({ address }, "Flux API started")
} catch (error) {
  app.log.fatal({ err: error }, "Failed to start Flux API")
  process.exitCode = 1
  await backgroundJobs?.stop()
  await app.close()
}
