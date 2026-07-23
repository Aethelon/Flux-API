import type { Kysely } from "kysely"
import { Migrator } from "kysely/migration"
import type { Database } from "./types.js"
import { migrationProvider } from "./migrations/index.js"

function createMigrator(database: Kysely<Database>): Migrator {
  return new Migrator({
    db: database,
    provider: migrationProvider,
  })
}

export async function migrateToLatest(database: Kysely<Database>): Promise<void> {
  const result = await createMigrator(database).migrateToLatest()

  if (result.error) {
    throw result.error instanceof Error
      ? result.error
      : new Error("Database migration failed", { cause: result.error })
  }
}

export async function migrateDown(database: Kysely<Database>): Promise<void> {
  const result = await createMigrator(database).migrateDown()

  if (result.error) {
    throw result.error instanceof Error
      ? result.error
      : new Error("Database migration rollback failed", { cause: result.error })
  }
}
