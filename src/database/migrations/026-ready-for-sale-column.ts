import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const readyForSaleColumnMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE service_order_columns
      ADD COLUMN ready_for_sale boolean NOT NULL DEFAULT false
    `.execute(db)

    await sql`
      ALTER TABLE service_order_columns
      DROP CONSTRAINT service_order_columns_terminal_protection_check
    `.execute(db)

    await sql`
      WITH candidates AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id
            ORDER BY display_position, id
          ) AS position
        FROM service_order_columns
        WHERE archived_at IS NULL
          AND semantic_type = 'open'
          AND lower(btrim(label)) = 'pronto'
      )
      UPDATE service_order_columns AS target_column
      SET
        ready_for_sale = true,
        protected = true,
        updated_at = now(),
        version = version + 1
      FROM candidates
      WHERE target_column.id = candidates.id
        AND candidates.position = 1
    `.execute(db)

    await sql`
      INSERT INTO service_order_columns (
        tenant_id,
        label,
        semantic_type,
        color_token,
        display_position,
        protected,
        ready_for_sale,
        created_by,
        updated_by
      )
      SELECT
        tenant.id,
        'Pronto',
        'open',
        '--color-info',
        COALESCE(position.last_position, -1) + 1,
        true,
        true,
        actor.id,
        actor.id
      FROM tenants AS tenant
      CROSS JOIN LATERAL (
        SELECT id
        FROM users
        WHERE tenant_id = tenant.id
          AND archived_at IS NULL
        ORDER BY
          CASE WHEN role = 'admin' AND status = 'active' THEN 0 ELSE 1 END,
          created_at,
          id
        LIMIT 1
      ) AS actor
      LEFT JOIN LATERAL (
        SELECT MAX(display_position) AS last_position
        FROM service_order_columns
        WHERE tenant_id = tenant.id
          AND archived_at IS NULL
      ) AS position ON true
      WHERE NOT EXISTS (
        SELECT 1
        FROM service_order_columns
        WHERE tenant_id = tenant.id
          AND ready_for_sale
          AND archived_at IS NULL
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX service_order_columns_ready_for_sale_uidx
      ON service_order_columns (tenant_id)
      WHERE ready_for_sale AND archived_at IS NULL
    `.execute(db)

    await sql`
      ALTER TABLE service_order_columns
      ADD CONSTRAINT service_order_columns_ready_protection_check
      CHECK (
        (NOT ready_for_sale OR semantic_type = 'open')
        AND protected = (
          semantic_type IN ('completed', 'cancelled') OR ready_for_sale
        )
      )
    `.execute(db)

    await sql`
      INSERT INTO service_order_status_history (
        tenant_id,
        service_order_id,
        previous_column_id,
        new_column_id,
        previous_status,
        new_status,
        actor_user_id,
        occurred_at,
        reason,
        metadata
      )
      SELECT
        service_order.tenant_id,
        service_order.id,
        service_order.current_column_id,
        ready.id,
        'completed',
        'open',
        service_order.updated_by,
        now(),
        'Moved to the ready-for-sale stage during the workflow migration.',
        '{"migration":"026-ready-for-sale-column"}'::jsonb
      FROM service_orders AS service_order
      INNER JOIN service_order_columns AS ready
        ON ready.tenant_id = service_order.tenant_id
        AND ready.ready_for_sale
        AND ready.archived_at IS NULL
      WHERE service_order.current_status = 'completed'
        AND service_order.final_sale_id IS NULL
    `.execute(db)

    await sql`
      UPDATE service_orders AS service_order
      SET
        current_column_id = ready.id,
        current_status = 'open',
        completed_at = NULL,
        cancelled_at = NULL,
        updated_at = now(),
        version = service_order.version + 1
      FROM service_order_columns AS ready
      WHERE ready.tenant_id = service_order.tenant_id
        AND ready.ready_for_sale
        AND ready.archived_at IS NULL
        AND service_order.current_status = 'completed'
        AND service_order.final_sale_id IS NULL
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      UPDATE service_orders AS service_order
      SET
        current_column_id = completed.id,
        current_status = 'completed',
        completed_at = now(),
        cancelled_at = NULL,
        updated_at = now(),
        version = service_order.version + 1
      FROM service_order_columns AS ready
      INNER JOIN service_order_columns AS completed
        ON completed.tenant_id = ready.tenant_id
        AND completed.semantic_type = 'completed'
        AND completed.archived_at IS NULL
      WHERE service_order.tenant_id = ready.tenant_id
        AND service_order.current_column_id = ready.id
        AND ready.ready_for_sale
        AND ready.archived_at IS NULL
        AND service_order.final_sale_id IS NULL
    `.execute(db)

    await sql`DROP INDEX service_order_columns_ready_for_sale_uidx`.execute(db)
    await sql`
      ALTER TABLE service_order_columns
      DROP CONSTRAINT service_order_columns_ready_protection_check
    `.execute(db)
    await sql`
      UPDATE service_order_columns
      SET protected = semantic_type IN ('completed', 'cancelled')
    `.execute(db)
    await sql`
      ALTER TABLE service_order_columns
      DROP COLUMN ready_for_sale
    `.execute(db)
    await sql`
      ALTER TABLE service_order_columns
      ADD CONSTRAINT service_order_columns_terminal_protection_check
      CHECK (protected = (semantic_type IN ('completed', 'cancelled')))
    `.execute(db)
  },
}
