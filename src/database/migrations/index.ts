import type { Migration, MigrationProvider } from "kysely/migration"
import { foundationMigration } from "./001-foundation.js"
import { catalogMigration } from "./002-catalog.js"
import { inventoryMigration } from "./003-inventory.js"
import { stockCountsMigration } from "./004-stock-counts.js"
import { peopleMigration } from "./005-people.js"
import { supplyMigration } from "./006-supply.js"
import { cashMigration } from "./007-cash.js"
import { salesMigration } from "./008-sales.js"
import { serviceOrdersMigration } from "./009-service-orders.js"
import { phaseOneIntegrityMigration } from "./010-phase-one-integrity.js"
import { zeroValueReturnsMigration } from "./011-zero-value-returns.js"
import { historyDashboardExportsMigration } from "./012-history-dashboard-exports.js"
import { deterministicIntelligenceMigration } from "./013-deterministic-intelligence.js"
import { intelligenceHardeningMigration } from "./014-intelligence-hardening.js"
import { aiExplanationMigration } from "./015-ai-explanation.js"

const migrations: Record<string, Migration> = {
  "001-foundation": foundationMigration,
  "002-catalog": catalogMigration,
  "003-inventory": inventoryMigration,
  "004-stock-counts": stockCountsMigration,
  "005-people": peopleMigration,
  "006-supply": supplyMigration,
  "007-cash": cashMigration,
  "008-sales": salesMigration,
  "009-service-orders": serviceOrdersMigration,
  "010-phase-one-integrity": phaseOneIntegrityMigration,
  "011-zero-value-returns": zeroValueReturnsMigration,
  "012-history-dashboard-exports": historyDashboardExportsMigration,
  "013-deterministic-intelligence": deterministicIntelligenceMigration,
  "014-intelligence-hardening": intelligenceHardeningMigration,
  "015-ai-explanation": aiExplanationMigration,
}

export const migrationProvider: MigrationProvider = {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations)
  },
}
