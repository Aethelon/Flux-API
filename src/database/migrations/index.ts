import type { Migration, MigrationProvider } from "kysely/migration"
import { foundationMigration } from "./001-foundation.js"
import { catalogMigration } from "./002-catalog.js"
import { inventoryMigration } from "./003-inventory.js"

const migrations: Record<string, Migration> = {
  "001-foundation": foundationMigration,
  "002-catalog": catalogMigration,
  "003-inventory": inventoryMigration,
}

export const migrationProvider: MigrationProvider = {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations)
  },
}
