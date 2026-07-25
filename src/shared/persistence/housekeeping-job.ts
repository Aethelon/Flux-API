import type { Kysely } from "kysely"
import type { AppConfig } from "../../config/env.js"
import type { Database } from "../../database/types.js"

export interface HousekeepingResult {
  idempotencyRecords: number
  outboxEvents: number
  authSessions: number
}

export async function runHousekeeping(
  database: Kysely<Database>,
  config: AppConfig,
  now = new Date(),
): Promise<HousekeepingResult> {
  const outboxBefore = new Date(
    now.getTime() - (config.outboxRetentionDays * 24 * 60 * 60 * 1_000),
  )
  const sessionsBefore = new Date(
    now.getTime() - (config.authSessionRetentionDays * 24 * 60 * 60 * 1_000),
  )
  return database.transaction().execute(async (transaction) => {
    const idempotency = await transaction.deleteFrom("idempotency_records")
      .where("expires_at", "<=", now).executeTakeFirst()
    const outbox = await transaction.deleteFrom("outbox_events")
      .where("status", "=", "completed")
      .where("created_at", "<=", outboxBefore).executeTakeFirst()
    const sessions = await transaction.deleteFrom("auth_sessions")
      .where("expires_at", "<=", sessionsBefore)
      .executeTakeFirst()
    return {
      idempotencyRecords: Number(idempotency.numDeletedRows),
      outboxEvents: Number(outbox.numDeletedRows),
      authSessions: Number(sessions.numDeletedRows),
    }
  })
}
