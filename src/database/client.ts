import { Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"
import type { AppConfig } from "../config/env.js"
import type { Database } from "./types.js"

export function createDatabase(config: AppConfig): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: config.databaseUrl,
        max: config.databasePoolMax,
        connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
        statement_timeout: config.databaseStatementTimeoutMs,
        idle_in_transaction_session_timeout: config.databaseIdleTransactionTimeoutMs,
        application_name: "flux-api",
      }),
    }),
  })
}
