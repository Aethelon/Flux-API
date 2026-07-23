import { loadConfig } from "./config/env.js"
import { createDatabase } from "./database/client.js"

const config = loadConfig()
const database = createDatabase(config)
let stopping = false

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.info(`Flux worker stopping after ${signal}.`)
  await database.destroy()
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
})

process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
})

console.info("Flux worker ready. No background handlers are registered yet.")
