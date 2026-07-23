import { loadConfig } from "../config/env.js"
import { createDatabase } from "./client.js"
import { migrateDown, migrateToLatest } from "./migrator.js"

const direction = process.argv[2]

if (direction !== "up" && direction !== "down") {
  throw new Error("Usage: npm run db:migrate or npm run db:migrate:down")
}

const database = createDatabase(loadConfig())

try {
  if (direction === "up") {
    await migrateToLatest(database)
    console.info("Database is up to date.")
  } else {
    await migrateDown(database)
    console.info("Latest migration reverted.")
  }
} finally {
  await database.destroy()
}
