import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"

export async function closeInventoryDailySnapshots(
  database: Kysely<Database>,
  referenceTime = new Date(),
): Promise<number> {
  const result = await sql<{ product_id: string }>`
    UPDATE inventory_daily_snapshots AS snapshot
    SET
      in_stock_minutes = snapshot.in_stock_minutes + CASE
        WHEN snapshot.closing > 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            (
              (snapshot.local_date + 1)::timestamp
              AT TIME ZONE settings.timezone
            ) - snapshot.last_observed_at
          )) / 60,
          0
        )
        ELSE 0
      END,
      stockout_minutes = snapshot.stockout_minutes + CASE
        WHEN snapshot.closing <= 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            (
              (snapshot.local_date + 1)::timestamp
              AT TIME ZONE settings.timezone
            ) - snapshot.last_observed_at
          )) / 60,
          0
        )
        ELSE 0
      END,
      observed_minutes = snapshot.observed_minutes + GREATEST(
        EXTRACT(EPOCH FROM (
          (
            (snapshot.local_date + 1)::timestamp
            AT TIME ZONE settings.timezone
          ) - snapshot.last_observed_at
        )) / 60,
        0
      ),
      last_observed_at = (
        (snapshot.local_date + 1)::timestamp
        AT TIME ZONE settings.timezone
      ),
      complete = true,
      updated_at = now()
    FROM tenant_settings AS settings
    WHERE settings.tenant_id = snapshot.tenant_id
      AND snapshot.complete = false
      AND snapshot.local_date
        < timezone(settings.timezone, ${referenceTime}::timestamptz)::date
    RETURNING snapshot.product_id
  `.execute(database)

  return result.rows.length
}
