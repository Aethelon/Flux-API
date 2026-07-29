import { sql, type Kysely } from "kysely"
import type {
  Database,
  PaymentMethod,
  ProductType,
  SaleStatus,
} from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import type {
  HistoryKpiInput,
  HistoryKpis,
  ReportContext,
  SaleHistoryFilters,
  SaleHistoryRecord,
} from "./types.js"

interface HistoryRow {
  id: string
  business_number: string
  status: SaleStatus
  business_date: string
  completed_at: Date
  cancelled_at: Date | null
  customer_id: string | null
  customer_name_snapshot: string | null
  operator_id: string
  operator_name: string
  item_count: string
  item_names: string[]
  items: Array<{
    productName: string
    productType: ProductType
    quantity: number
    grossAmountCents: number
  }>
  payment_methods: PaymentMethod[]
  payments: Array<{
    method: PaymentMethod
    effectiveAmountCents: number
    installments: number | null
  }>
  returned_amount_cents: string
  gross_amount_cents: string
  discount_amount_cents: string
  net_amount_cents: string
  cogs_cents: string | null
  cost_complete: boolean
}

interface KpiRow {
  gross_revenue_cents: string
  discount_amount_cents: string
  returned_amount_cents: string
  net_revenue_cents: string
  completed_sale_count: string
  units_sold: string
  cogs_cents: string | null
  cost_line_count: string
  eligible_cost_line_count: string
}

interface PaymentRow {
  payment_method: PaymentMethod
  net_received_cents: string
}

export interface HistoryRepository {
  listSales(
    tenantId: string,
    filters: SaleHistoryFilters,
    includeFinancials: boolean,
  ): Promise<{ data: SaleHistoryRecord[]; hasMore: boolean }>
  getKpis(tenantId: string, input: HistoryKpiInput): Promise<HistoryKpis>
  resolveReportContext(tenantId: string, input: HistoryKpiInput): Promise<ReportContext>
}

function optionalDatePredicate(column: string, operator: ">=" | "<", value?: Date) {
  if (!value) return sql<boolean>`true`
  return operator === ">="
    ? sql<boolean>`${sql.ref(column)} >= ${value}`
    : sql<boolean>`${sql.ref(column)} < ${value}`
}

function mapHistoryRow(row: HistoryRow, includeFinancials: boolean): SaleHistoryRecord {
  const netRevenueCents = Number(row.net_amount_cents) - Number(row.returned_amount_cents)
  const cogsCents = row.cost_complete && row.cogs_cents !== null
    ? Math.round(Number(row.cogs_cents))
    : null
  const grossProfitCents = cogsCents === null ? null : netRevenueCents - cogsCents

  return {
    id: row.id,
    businessNumber: Number(row.business_number),
    status: row.status,
    businessDate: row.business_date,
    completedAt: row.completed_at.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    customer: row.customer_id && row.customer_name_snapshot
      ? { id: row.customer_id, name: row.customer_name_snapshot }
      : null,
    operator: { id: row.operator_id, name: row.operator_name },
    itemCount: Number(row.item_count),
    itemNames: row.item_names,
    paymentMethods: row.payment_methods,
    hasReturns: Number(row.returned_amount_cents) > 0,
    ...(includeFinancials
      ? {
          details: {
            items: row.items,
            payments: row.payments,
          },
          financial: {
            grossAmountCents: Number(row.gross_amount_cents),
            discountAmountCents: Number(row.discount_amount_cents),
            returnedAmountCents: Number(row.returned_amount_cents),
            netRevenueCents,
            cogsCents,
            grossProfitCents,
            grossMarginRate: grossProfitCents === null || netRevenueCents === 0
              ? null
              : grossProfitCents / netRevenueCents,
            costComplete: row.cost_complete,
          },
        }
      : {}),
  }
}

export class KyselyHistoryRepository implements HistoryRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listSales(
    tenantId: string,
    filters: SaleHistoryFilters,
    includeFinancials: boolean,
  ): Promise<{ data: SaleHistoryRecord[]; hasMore: boolean }> {
    const cursorPredicate = filters.cursor
      ? sql<boolean>`
          (sale.completed_at, sale.id)
          < (${new Date(filters.cursor.completedAt)}, ${filters.cursor.id}::uuid)
        `
      : sql<boolean>`true`
    const statusPredicate = filters.status
      ? sql<boolean>`sale.status = ${filters.status}`
      : sql<boolean>`true`
    const customerPredicate = filters.customerId
      ? sql<boolean>`sale.customer_id = ${filters.customerId}::uuid`
      : sql<boolean>`true`
    const operatorPredicate = filters.operatorId
      ? sql<boolean>`sale.operator_id = ${filters.operatorId}::uuid`
      : sql<boolean>`true`
    const paymentPredicate = filters.paymentMethod
      ? sql<boolean>`EXISTS (
          SELECT 1
          FROM payments AS requested_payment
          WHERE requested_payment.tenant_id = sale.tenant_id
            AND requested_payment.sale_id = sale.id
            AND requested_payment.payment_method = ${filters.paymentMethod}
        )`
      : sql<boolean>`true`
    const search = filters.search?.trim()
    const searchPredicate = search
      ? sql<boolean>`(
          sale.business_number::text ILIKE ${`%${search}%`}
          OR COALESCE(sale.customer_name_snapshot, '') ILIKE ${`%${search}%`}
          OR operator.name ILIKE ${`%${search}%`}
          OR EXISTS (
            SELECT 1
            FROM sale_items AS searched_item
            WHERE searched_item.tenant_id = sale.tenant_id
              AND searched_item.sale_id = sale.id
              AND searched_item.product_name_snapshot ILIKE ${`%${search}%`}
          )
        )`
      : sql<boolean>`true`

    const result = await sql<HistoryRow>`
      SELECT
        sale.id,
        sale.business_number,
        sale.status,
        sale.business_date::text,
        sale.completed_at,
        sale.cancelled_at,
        sale.customer_id,
        sale.customer_name_snapshot,
        operator.id AS operator_id,
        operator.name AS operator_name,
        item_summary.item_count,
        item_summary.item_names,
        item_summary.items,
        payment_summary.payment_methods,
        payment_summary.payments,
        sale.returned_amount_cents,
        sale.gross_amount_cents,
        sale.discount_amount_cents,
        sale.net_amount_cents,
        item_summary.cogs_cents,
        item_summary.cost_complete
      FROM sales AS sale
      INNER JOIN users AS operator
        ON operator.id = sale.operator_id
        AND operator.tenant_id = sale.tenant_id
      INNER JOIN LATERAL (
        SELECT
          COUNT(*)::text AS item_count,
          ARRAY_AGG(
            item.product_name_snapshot
            ORDER BY item.created_at, item.id
          ) AS item_names,
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'productName', item.product_name_snapshot,
              'productType', item.product_type_snapshot,
              'quantity', item.quantity,
              'grossAmountCents', item.gross_amount_cents
            )
            ORDER BY item.created_at, item.id
          ) AS items,
          SUM(
            (item.quantity - item.returned_quantity)
              * item.unit_cost_snapshot_cents
          )::text AS cogs_cents,
          BOOL_AND(
            item.quantity = item.returned_quantity
            OR item.unit_cost_snapshot_cents IS NOT NULL
          ) AS cost_complete
        FROM sale_items AS item
        WHERE item.tenant_id = sale.tenant_id
          AND item.sale_id = sale.id
      ) AS item_summary ON true
      INNER JOIN LATERAL (
        SELECT
          COALESCE(
            ARRAY_AGG(DISTINCT payment.payment_method)
              FILTER (WHERE payment.payment_method IS NOT NULL),
            ARRAY[]::text[]
          ) AS payment_methods,
          COALESCE(
            JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'method', payment.payment_method,
                'effectiveAmountCents', payment.effective_amount_cents,
                'installments', payment.installments
              )
              ORDER BY payment.created_at, payment.id
            ) FILTER (WHERE payment.id IS NOT NULL),
            '[]'::jsonb
          ) AS payments
        FROM payments AS payment
        WHERE payment.tenant_id = sale.tenant_id
          AND payment.sale_id = sale.id
      ) AS payment_summary ON true
      WHERE sale.tenant_id = ${tenantId}::uuid
        AND ${optionalDatePredicate("sale.completed_at", ">=", filters.from)}
        AND ${optionalDatePredicate("sale.completed_at", "<", filters.to)}
        AND ${statusPredicate}
        AND ${customerPredicate}
        AND ${operatorPredicate}
        AND ${paymentPredicate}
        AND ${searchPredicate}
        AND ${cursorPredicate}
      ORDER BY sale.completed_at DESC, sale.id DESC
      LIMIT ${filters.limit + 1}
    `.execute(this.database)
    const hasMore = result.rows.length > filters.limit

    return {
      data: result.rows.slice(0, filters.limit)
        .map((row) => mapHistoryRow(row, includeFinancials)),
      hasMore,
    }
  }

  async resolveReportContext(
    tenantId: string,
    input: HistoryKpiInput,
  ): Promise<ReportContext> {
    const result = await sql<{
      timezone: string
      currency: string
      from_at: Date
      to_at: Date
      generated_at: Date
    }>`
      SELECT
        settings.timezone,
        settings.currency,
        COALESCE(
          ${input.from ?? null}::timestamptz,
          date_trunc('month', now() AT TIME ZONE settings.timezone)
            AT TIME ZONE settings.timezone
        ) AS from_at,
        COALESCE(${input.to ?? null}::timestamptz, now()) AS to_at,
        now() AS generated_at
      FROM tenant_settings AS settings
      WHERE settings.tenant_id = ${tenantId}::uuid
    `.execute(this.database)
    const row = result.rows[0]
    if (!row) throw new Error("Tenant settings are unavailable")
    if (row.from_at >= row.to_at) {
      throw new AppError(400, "INVALID_DATE_RANGE", "from must be earlier than to.")
    }
    return {
      timezone: row.timezone,
      currency: row.currency,
      from: row.from_at,
      to: row.to_at,
      generatedAt: row.generated_at,
    }
  }

  async getKpis(tenantId: string, input: HistoryKpiInput): Promise<HistoryKpis> {
    const context = await this.resolveReportContext(tenantId, input)
    const [summaryResult, paymentResult] = await Promise.all([
      sql<KpiRow>`
        WITH eligible_sales AS (
          SELECT *
          FROM sales
          WHERE tenant_id = ${tenantId}::uuid
            AND completed_at >= ${context.from}
            AND completed_at < ${context.to}
            AND status <> 'cancelled'
        ),
        eligible_returns AS (
          SELECT sale_return.*
          FROM sale_returns AS sale_return
          INNER JOIN sales AS original_sale
            ON original_sale.id = sale_return.sale_id
            AND original_sale.tenant_id = sale_return.tenant_id
          WHERE sale_return.tenant_id = ${tenantId}::uuid
            AND sale_return.completed_at >= ${context.from}
            AND sale_return.completed_at < ${context.to}
            AND original_sale.status <> 'cancelled'
        ),
        sale_summary AS (
          SELECT
            COALESCE(SUM(gross_amount_cents), 0)::text AS gross_revenue_cents,
            COALESCE(SUM(discount_amount_cents), 0)::text AS discount_amount_cents,
            COUNT(*)::text AS completed_sale_count
          FROM eligible_sales
        ),
        return_summary AS (
          SELECT COALESCE(SUM(total_amount_cents), 0)::text AS returned_amount_cents
          FROM eligible_returns
        ),
        sold_item_summary AS (
          SELECT
            COALESCE(SUM(item.quantity), 0) AS units,
            COALESCE(SUM(item.quantity * item.unit_cost_snapshot_cents), 0) AS cogs,
            COUNT(*) AS cost_line_count,
            COUNT(*) FILTER (
              WHERE item.unit_cost_snapshot_cents IS NOT NULL
            ) AS eligible_cost_line_count
          FROM sale_items AS item
          INNER JOIN eligible_sales AS sale
            ON sale.id = item.sale_id
            AND sale.tenant_id = item.tenant_id
        ),
        returned_item_summary AS (
          SELECT
            COALESCE(SUM(return_item.quantity), 0) AS units,
            COALESCE(
              SUM(return_item.quantity * return_item.unit_cost_snapshot_cents),
              0
            ) AS cogs,
            COUNT(*) AS cost_line_count,
            COUNT(*) FILTER (
              WHERE return_item.unit_cost_snapshot_cents IS NOT NULL
            ) AS eligible_cost_line_count
          FROM sale_return_items AS return_item
          INNER JOIN eligible_returns AS sale_return
            ON sale_return.id = return_item.return_id
            AND sale_return.tenant_id = return_item.tenant_id
        )
        SELECT
          sale_summary.gross_revenue_cents,
          sale_summary.discount_amount_cents,
          return_summary.returned_amount_cents,
          (
            sale_summary.gross_revenue_cents::bigint
            - sale_summary.discount_amount_cents::bigint
            - return_summary.returned_amount_cents::bigint
          )::text AS net_revenue_cents,
          sale_summary.completed_sale_count,
          (sold_item_summary.units - returned_item_summary.units)::text AS units_sold,
          (sold_item_summary.cogs - returned_item_summary.cogs)::text AS cogs_cents,
          (
            sold_item_summary.cost_line_count
            + returned_item_summary.cost_line_count
          )::text AS cost_line_count,
          (
            sold_item_summary.eligible_cost_line_count
            + returned_item_summary.eligible_cost_line_count
          )::text AS eligible_cost_line_count
        FROM sale_summary
        CROSS JOIN return_summary
        CROSS JOIN sold_item_summary
        CROSS JOIN returned_item_summary
      `.execute(this.database),
      sql<PaymentRow>`
        WITH payment_totals AS (
          SELECT
            payment.payment_method,
            SUM(payment.effective_amount_cents) AS amount_cents
          FROM payments AS payment
          INNER JOIN sales AS sale
            ON sale.id = payment.sale_id
            AND sale.tenant_id = payment.tenant_id
          WHERE sale.tenant_id = ${tenantId}::uuid
            AND sale.completed_at >= ${context.from}
            AND sale.completed_at < ${context.to}
            AND sale.status <> 'cancelled'
            AND payment.status <> 'reversed'
          GROUP BY payment.payment_method
        ),
        refund_totals AS (
          SELECT
            refund.payment_method,
            SUM(refund.amount_cents) AS amount_cents
          FROM sale_return_refunds AS refund
          INNER JOIN sale_returns AS sale_return
            ON sale_return.id = refund.return_id
            AND sale_return.tenant_id = refund.tenant_id
          INNER JOIN sales AS sale
            ON sale.id = sale_return.sale_id
            AND sale.tenant_id = sale_return.tenant_id
          WHERE sale_return.tenant_id = ${tenantId}::uuid
            AND sale_return.completed_at >= ${context.from}
            AND sale_return.completed_at < ${context.to}
            AND sale.status <> 'cancelled'
          GROUP BY refund.payment_method
        )
        SELECT
          method.payment_method,
          (
            COALESCE(payment_totals.amount_cents, 0)
            - COALESCE(refund_totals.amount_cents, 0)
          )::text AS net_received_cents
        FROM (
          VALUES ('cash'), ('credit'), ('debit'), ('pix')
        ) AS method(payment_method)
        LEFT JOIN payment_totals USING (payment_method)
        LEFT JOIN refund_totals USING (payment_method)
        ORDER BY method.payment_method
      `.execute(this.database),
    ])
    const row = summaryResult.rows[0]
    if (!row) throw new Error("History KPI summary is unavailable")
    const grossRevenueCents = Number(row.gross_revenue_cents)
    const discountAmountCents = Number(row.discount_amount_cents)
    const returnedAmountCents = Number(row.returned_amount_cents)
    const netRevenueCents = Number(row.net_revenue_cents)
    const completedSaleCount = Number(row.completed_sale_count)
    const costLineCount = Number(row.cost_line_count)
    const eligibleCostLineCount = Number(row.eligible_cost_line_count)
    const costsComplete = costLineCount === eligibleCostLineCount
    const cogsCents = costsComplete
      ? Math.round(Number(row.cogs_cents ?? 0))
      : null
    const grossProfitCents = cogsCents === null ? null : netRevenueCents - cogsCents

    return {
      calculationVersion: "history-kpi-v1",
      dateRange: {
        from: context.from.toISOString(),
        to: context.to.toISOString(),
      },
      timezone: context.timezone,
      currency: context.currency,
      dataFreshnessAt: context.generatedAt.toISOString(),
      completeness: {
        transactionsComplete: true,
        costsComplete,
        costCoverageRate: costLineCount === 0 ? 1 : eligibleCostLineCount / costLineCount,
      },
      saleCountPolicy: "all_non_cancelled_completed_sales",
      grossRevenueCents,
      discountAmountCents,
      returnedAmountCents,
      netRevenueCents,
      completedSaleCount,
      averageTicketCents: completedSaleCount === 0
        ? null
        : Math.round(netRevenueCents / completedSaleCount),
      unitsSold: Number(row.units_sold),
      cogsCents,
      grossProfitCents,
      grossMarginRate: grossProfitCents === null || netRevenueCents === 0
        ? null
        : grossProfitCents / netRevenueCents,
      paymentMethods: paymentResult.rows.map((payment) => ({
        method: payment.payment_method,
        netReceivedCents: Number(payment.net_received_cents),
      })),
    }
  }
}
