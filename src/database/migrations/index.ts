import type { Migration, MigrationProvider } from "kysely/migration"
import { foundationMigration } from "./001-foundation.js"

const migrations: Record<string, Migration> = {
  "001-foundation": foundationMigration,
}

export const migrationProvider: MigrationProvider = {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations)
  },
}
