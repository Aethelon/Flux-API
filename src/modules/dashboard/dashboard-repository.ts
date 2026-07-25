import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import type { HistoryRepository } from "../history/history-repository.js"
import type { Dashboard, DashboardInput } from "./types.js"

interface RevenueRow {
  bucket_start: string
  gross_revenue_cents: string
  discount_amount_cents: string
  returned_amount_cents: string
  net_revenue_cents: string
}

interface TopProductRow {
  product_id: string
  name: string
  units_sold: string
  net_revenue_cents: string
}

interface InventoryRow {
  active_product_count: string
  sold_out_count: string
  low_stock_count: string
  inventory_value_cents: string
  cost_product_count: string
  cost_complete_count: string
}

interface ServiceOrderRow {
  created_count: string
  completed_count: string
  open_count: string
  overdue_open_count: string
  average_cycle_time_hours: string | null
  on_time_count: string
}

interface CashRow {
  opened_session_count: string
  closed_session_count: string
  closing_difference_cents: string
}

export interface DashboardRepository {
  get(tenantId: string, input: DashboardInput): Promise<Dashboard>
}

function bucketParts(bucket: DashboardInput["bucket"]): {
  trunc: string
  interval: string
} {
  switch (bucket) {
    case "day":
      return { trunc: "day", interval: "1 day" }
    case "week":
      return { trunc: "week", interval: "1 week" }
    case "month":
      return { trunc: "month", interval: "1 month" }
  }
}

export class KyselyDashboardRepository implements DashboardRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly historyRepository: HistoryRepository,
  ) {}

  async get(tenantId: string, input: DashboardInput): Promise<Dashboard> {
    const sales = await this.historyRepository.getKpis(tenantId, {
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
    })
    const from = new Date(sales.dateRange.from)
    const to = new Date(sales.dateRange.to)
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1_000)
    const maxRangeDays = input.bucket === "day"
      ? 366
      : input.bucket === "week"
        ? 5 * 366
        : 10 * 366
    if (rangeDays > maxRangeDays) {
      throw new AppError(
        400,
        "DASHBOARD_RANGE_TOO_LARGE",
        `The selected ${input.bucket} dashboard range is too large.`,
      )
    }
    const bucket = bucketParts(input.bucket)
    const rankOrder = input.topBy === "units"
      ? sql.raw("units_sold DESC")
      : sql.raw("net_revenue_cents DESC")

    const [
      revenueResult,
      topProductsResult,
      inventoryResult,
      serviceOrdersResult,
      cashResult,
    ] = await Promise.all([
      sql<RevenueRow>`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(
              ${sql.raw(`'${bucket.trunc}'`)},
              ${from}::timestamptz AT TIME ZONE ${sales.timezone}
            ),
            date_trunc(
              ${sql.raw(`'${bucket.trunc}'`)},
              (${to}::timestamptz - interval '1 microsecond')
                AT TIME ZONE ${sales.timezone}
            ),
            ${sql.raw(`interval '${bucket.interval}'`)}
          ) AS bucket_start
        ),
        sale_totals AS (
          SELECT
            date_trunc(
              ${sql.raw(`'${bucket.trunc}'`)},
              sale.completed_at AT TIME ZONE ${sales.timezone}
            ) AS bucket_start,
            SUM(sale.gross_amount_cents) AS gross_revenue_cents,
            SUM(sale.discount_amount_cents) AS discount_amount_cents,
            SUM(sale.net_amount_cents) AS net_revenue_before_returns_cents
          FROM sales AS sale
          WHERE sale.tenant_id = ${tenantId}::uuid
            AND sale.completed_at >= ${from}
            AND sale.completed_at < ${to}
            AND sale.status <> 'cancelled'
          GROUP BY bucket_start
        ),
        return_totals AS (
          SELECT
            date_trunc(
              ${sql.raw(`'${bucket.trunc}'`)},
              sale_return.completed_at AT TIME ZONE ${sales.timezone}
            ) AS bucket_start,
            SUM(sale_return.total_amount_cents) AS returned_amount_cents
          FROM sale_returns AS sale_return
          INNER JOIN sales AS original_sale
            ON original_sale.id = sale_return.sale_id
            AND original_sale.tenant_id = sale_return.tenant_id
          WHERE sale_return.tenant_id = ${tenantId}::uuid
            AND sale_return.completed_at >= ${from}
            AND sale_return.completed_at < ${to}
            AND original_sale.status <> 'cancelled'
          GROUP BY bucket_start
        )
        SELECT
          to_char(buckets.bucket_start, 'YYYY-MM-DD') AS bucket_start,
          COALESCE(sale_totals.gross_revenue_cents, 0)::text AS gross_revenue_cents,
          COALESCE(sale_totals.discount_amount_cents, 0)::text AS discount_amount_cents,
          COALESCE(return_totals.returned_amount_cents, 0)::text AS returned_amount_cents,
          (
            COALESCE(sale_totals.net_revenue_before_returns_cents, 0)
            - COALESCE(return_totals.returned_amount_cents, 0)
          )::text AS net_revenue_cents
        FROM buckets
        LEFT JOIN sale_totals USING (bucket_start)
        LEFT JOIN return_totals USING (bucket_start)
        ORDER BY buckets.bucket_start
      `.execute(this.database),
      sql<TopProductRow>`
        WITH sold AS (
          SELECT
            item.product_id,
            (
              ARRAY_AGG(
                item.product_name_snapshot
                ORDER BY sale.completed_at DESC, sale.id DESC
              )
            )[1] AS name,
            SUM(item.quantity) AS units,
            SUM(item.net_amount_cents) AS revenue_cents
          FROM sale_items AS item
          INNER JOIN sales AS sale
            ON sale.id = item.sale_id
            AND sale.tenant_id = item.tenant_id
          WHERE sale.tenant_id = ${tenantId}::uuid
            AND sale.completed_at >= ${from}
            AND sale.completed_at < ${to}
            AND sale.status <> 'cancelled'
            AND item.product_id IS NOT NULL
          GROUP BY item.product_id
        ),
        returned AS (
          SELECT
            original_item.product_id,
            (
              ARRAY_AGG(
                original_item.product_name_snapshot
                ORDER BY sale_return.completed_at DESC, sale_return.id DESC
              )
            )[1] AS name,
            SUM(return_item.quantity) AS units,
            SUM(return_item.amount_cents) AS revenue_cents
          FROM sale_return_items AS return_item
          INNER JOIN sale_returns AS sale_return
            ON sale_return.id = return_item.return_id
            AND sale_return.tenant_id = return_item.tenant_id
          INNER JOIN sales AS original_sale
            ON original_sale.id = sale_return.sale_id
            AND original_sale.tenant_id = sale_return.tenant_id
          INNER JOIN sale_items AS original_item
            ON original_item.id = return_item.sale_item_id
            AND original_item.tenant_id = return_item.tenant_id
          WHERE sale_return.tenant_id = ${tenantId}::uuid
            AND sale_return.completed_at >= ${from}
            AND sale_return.completed_at < ${to}
            AND original_sale.status <> 'cancelled'
            AND original_item.product_id IS NOT NULL
          GROUP BY original_item.product_id
        )
        SELECT
          COALESCE(sold.product_id, returned.product_id) AS product_id,
          COALESCE(sold.name, returned.name) AS name,
          COALESCE(sold.units, 0) - COALESCE(returned.units, 0) AS units_sold,
          COALESCE(sold.revenue_cents, 0)
            - COALESCE(returned.revenue_cents, 0) AS net_revenue_cents
        FROM sold
        FULL OUTER JOIN returned USING (product_id)
        ORDER BY ${rankOrder}, name, product_id
        LIMIT ${input.topLimit}
      `.execute(this.database),
      sql<InventoryRow>`
        SELECT
          COUNT(*)::text AS active_product_count,
          COUNT(*) FILTER (WHERE balance.on_hand <= 0)::text AS sold_out_count,
          COUNT(*) FILTER (
            WHERE balance.on_hand > 0
              AND balance.on_hand <= product.minimum_stock
          )::text AS low_stock_count,
          COALESCE(
            SUM(balance.on_hand * balance.average_unit_cost_cents),
            0
          )::text AS inventory_value_cents,
          COUNT(*) FILTER (WHERE balance.on_hand > 0)::text AS cost_product_count,
          COUNT(*) FILTER (
            WHERE balance.on_hand > 0
              AND balance.average_unit_cost_cents IS NOT NULL
          )::text AS cost_complete_count
        FROM inventory_balances AS balance
        INNER JOIN products AS product
          ON product.id = balance.product_id
          AND product.tenant_id = balance.tenant_id
        WHERE product.tenant_id = ${tenantId}::uuid
          AND product.active
          AND product.archived_at IS NULL
          AND product.type <> 'service'
      `.execute(this.database),
      sql<ServiceOrderRow>`
        SELECT
          COUNT(*) FILTER (
            WHERE service_order.created_at >= ${from}
              AND service_order.created_at < ${to}
              AND service_order.current_status <> 'cancelled'
          )::text AS created_count,
          COUNT(*) FILTER (
            WHERE service_order.created_at >= ${from}
              AND service_order.created_at < ${to}
              AND service_order.current_status = 'completed'
              AND service_order.completed_at < ${to}
          )::text AS completed_count,
          COUNT(*) FILTER (
            WHERE service_order.current_status = 'open'
          )::text AS open_count,
          COUNT(*) FILTER (
            WHERE service_order.current_status = 'open'
              AND service_order.due_at < ${to}
          )::text AS overdue_open_count,
          (
            AVG(
              EXTRACT(EPOCH FROM (
                service_order.completed_at - service_order.created_at
              )) / 3600
            ) FILTER (
              WHERE service_order.completed_at >= ${from}
                AND service_order.completed_at < ${to}
            )
          )::text AS average_cycle_time_hours,
          COUNT(*) FILTER (
            WHERE service_order.completed_at >= ${from}
              AND service_order.completed_at < ${to}
              AND service_order.due_at IS NOT NULL
              AND service_order.completed_at <= service_order.due_at
          )::text AS on_time_count
        FROM service_orders AS service_order
        WHERE service_order.tenant_id = ${tenantId}::uuid
      `.execute(this.database),
      sql<CashRow>`
        SELECT
          COUNT(DISTINCT session.id) FILTER (
            WHERE session.opened_at >= ${from}
              AND session.opened_at < ${to}
          )::text AS opened_session_count,
          COUNT(DISTINCT session.id) FILTER (
            WHERE session.closed_at >= ${from}
              AND session.closed_at < ${to}
          )::text AS closed_session_count,
          COALESCE(SUM(close_count.difference_cents) FILTER (
            WHERE session.closed_at >= ${from}
              AND session.closed_at < ${to}
          ), 0)::text AS closing_difference_cents
        FROM cash_sessions AS session
        LEFT JOIN cash_close_counts AS close_count
          ON close_count.tenant_id = session.tenant_id
          AND close_count.cash_session_id = session.id
        WHERE session.tenant_id = ${tenantId}::uuid
      `.execute(this.database),
    ])
    const inventory = inventoryResult.rows[0]
    const serviceOrders = serviceOrdersResult.rows[0]
    const cash = cashResult.rows[0]
    if (!inventory || !serviceOrders || !cash) {
      throw new Error("Dashboard aggregates are unavailable")
    }
    const inventoryCostCount = Number(inventory.cost_product_count)
    const inventoryCostCompleteCount = Number(inventory.cost_complete_count)
    const inventoryCostsComplete = inventoryCostCount === inventoryCostCompleteCount
    const completedCount = Number(serviceOrders.completed_count)
    const createdCount = Number(serviceOrders.created_count)
    const dueCompletedCount = await this.completedOrdersWithDueDate(tenantId, from, to)

    return {
      calculationVersion: "dashboard-v1",
      dateRange: sales.dateRange,
      timezone: sales.timezone,
      currency: sales.currency,
      dataFreshnessAt: sales.dataFreshnessAt,
      completeness: {
        ...sales.completeness,
        inventoryCostsComplete,
      },
      sales,
      revenueSeries: revenueResult.rows.map((row) => ({
        bucketStart: row.bucket_start,
        grossRevenueCents: Number(row.gross_revenue_cents),
        discountAmountCents: Number(row.discount_amount_cents),
        returnedAmountCents: Number(row.returned_amount_cents),
        netRevenueCents: Number(row.net_revenue_cents),
      })),
      topProducts: {
        rankedBy: input.topBy,
        data: topProductsResult.rows.map((row) => ({
          productId: row.product_id,
          name: row.name,
          unitsSold: Number(row.units_sold),
          netRevenueCents: Number(row.net_revenue_cents),
        })),
      },
      inventory: {
        activeProductCount: Number(inventory.active_product_count),
        soldOutCount: Number(inventory.sold_out_count),
        lowStockCount: Number(inventory.low_stock_count),
        inventoryValueCents: inventoryCostsComplete
          ? Math.round(Number(inventory.inventory_value_cents))
          : null,
      },
      serviceOrders: {
        createdCount,
        completedCount,
        openCount: Number(serviceOrders.open_count),
        overdueOpenCount: Number(serviceOrders.overdue_open_count),
        completionRate: createdCount === 0 ? null : completedCount / createdCount,
        averageCycleTimeHours: serviceOrders.average_cycle_time_hours === null
          ? null
          : Number(serviceOrders.average_cycle_time_hours),
        onTimeRate: dueCompletedCount === 0
          ? null
          : Number(serviceOrders.on_time_count) / dueCompletedCount,
      },
      cash: {
        openedSessionCount: Number(cash.opened_session_count),
        closedSessionCount: Number(cash.closed_session_count),
        closingDifferenceCents: Number(cash.closing_difference_cents),
      },
    }
  }

  private async completedOrdersWithDueDate(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const row = await this.database.selectFrom("service_orders")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("completed_at", ">=", from)
      .where("completed_at", "<", to)
      .where("due_at", "is not", null)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  }
}
