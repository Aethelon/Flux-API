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
      }),
    }),
  })
}
