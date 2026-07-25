import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"

export async function nextTenantSequence(
  database: Kysely<Database>,
  tenantId: string,
  sequenceName: string,
): Promise<number> {
  const row = await database.insertInto("tenant_sequences").values({
    tenant_id: tenantId,
    sequence_name: sequenceName,
    current_value: 1,
  }).onConflict((conflict) => conflict
    .columns(["tenant_id", "sequence_name"])
    .doUpdateSet({
      current_value: sql`tenant_sequences.current_value + 1`,
      updated_at: new Date(),
    }))
    .returning("current_value").executeTakeFirstOrThrow()

  return Number(row.current_value)
}
