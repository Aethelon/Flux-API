import { sql, type Kysely } from "kysely"
import type { Database, StockMovementType } from "../../database/types.js"

interface TrackingInput {
  tenantId: string
  productId: string
  movementId: string
  movementType: StockMovementType
  quantity: number
  oldOnHand: number
  newOnHand: number
  reserved: number
  occurredAt: Date
}

export async function recordInventoryTracking(
  database: Kysely<Database>,
  input: TrackingInput,
): Promise<void> {
  if (input.oldOnHand > 0 && input.newOnHand <= 0) {
    await database.insertInto("stockout_intervals").values({
      tenant_id: input.tenantId,
      product_id: input.productId,
      started_at: input.occurredAt,
      ended_at: null,
      detected_reason: input.movementType,
      source_movement_id: input.movementId,
      ended_by_movement_id: null,
    })
      .onConflict((conflict) => conflict
        .columns(["tenant_id", "product_id"])
        .where("ended_at", "is", null)
        .doNothing())
      .execute()
  } else if (input.oldOnHand <= 0 && input.newOnHand > 0) {
    await database.updateTable("stockout_intervals").set({
      ended_at: input.occurredAt,
      ended_by_movement_id: input.movementId,
    })
      .where("tenant_id", "=", input.tenantId)
      .where("product_id", "=", input.productId)
      .where("ended_at", "is", null)
      .execute()
  }

  const received = input.movementType === "receipt" ? Math.abs(input.quantity) : 0
  const sold = input.movementType === "sale" ? Math.abs(input.quantity) : 0
  const returned = input.movementType === "return"
    || input.movementType === "sale_reversal"
    ? Math.abs(input.quantity)
    : 0
  const adjusted = [
    "positive_adjustment",
    "negative_adjustment",
    "stock_count_adjustment",
  ].includes(input.movementType)
    ? input.quantity
    : 0

  await sql`
    WITH tenant_clock AS (
      SELECT timezone
      FROM tenant_settings
      WHERE tenant_id = ${input.tenantId}::uuid
    ),
    movement_clock AS (
      SELECT
        timezone(timezone, ${input.occurredAt}::timestamptz)::date AS local_date,
        (
          timezone(timezone, ${input.occurredAt}::timestamptz)::date::timestamp
          AT TIME ZONE timezone
        ) AS local_day_start
      FROM tenant_clock
    )
    INSERT INTO inventory_daily_snapshots (
      tenant_id,
      product_id,
      local_date,
      opening,
      received,
      sold,
      returned,
      adjusted,
      closing,
      reserved,
      in_stock_minutes,
      stockout_minutes,
      observed_minutes,
      last_observed_at,
      complete
    )
    SELECT
      ${input.tenantId}::uuid,
      ${input.productId}::uuid,
      movement_clock.local_date,
      ${input.oldOnHand},
      ${received},
      ${sold},
      ${returned},
      ${adjusted},
      ${input.newOnHand},
      ${input.reserved},
      CASE
        WHEN ${input.oldOnHand} > 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            ${input.occurredAt}::timestamptz - movement_clock.local_day_start
          )) / 60,
          0
        )
        ELSE 0
      END,
      CASE
        WHEN ${input.oldOnHand} <= 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            ${input.occurredAt}::timestamptz - movement_clock.local_day_start
          )) / 60,
          0
        )
        ELSE 0
      END,
      GREATEST(
        EXTRACT(EPOCH FROM (
          ${input.occurredAt}::timestamptz - movement_clock.local_day_start
        )) / 60,
        0
      ),
      ${input.occurredAt}::timestamptz,
      false
    FROM movement_clock
    ON CONFLICT (tenant_id, product_id, local_date)
    DO UPDATE SET
      received = inventory_daily_snapshots.received + EXCLUDED.received,
      sold = inventory_daily_snapshots.sold + EXCLUDED.sold,
      returned = inventory_daily_snapshots.returned + EXCLUDED.returned,
      adjusted = inventory_daily_snapshots.adjusted + EXCLUDED.adjusted,
      closing = EXCLUDED.closing,
      reserved = EXCLUDED.reserved,
      in_stock_minutes = inventory_daily_snapshots.in_stock_minutes + CASE
        WHEN inventory_daily_snapshots.closing > 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            EXCLUDED.last_observed_at - inventory_daily_snapshots.last_observed_at
          )) / 60,
          0
        )
        ELSE 0
      END,
      stockout_minutes = inventory_daily_snapshots.stockout_minutes + CASE
        WHEN inventory_daily_snapshots.closing <= 0 THEN GREATEST(
          EXTRACT(EPOCH FROM (
            EXCLUDED.last_observed_at - inventory_daily_snapshots.last_observed_at
          )) / 60,
          0
        )
        ELSE 0
      END,
      observed_minutes = inventory_daily_snapshots.observed_minutes + GREATEST(
        EXTRACT(EPOCH FROM (
          EXCLUDED.last_observed_at - inventory_daily_snapshots.last_observed_at
        )) / 60,
        0
      ),
      last_observed_at = GREATEST(
        inventory_daily_snapshots.last_observed_at,
        EXCLUDED.last_observed_at
      ),
      complete = false,
      updated_at = now()
  `.execute(database)
}
