import { sql, type Kysely } from "kysely"
import type { Database, PaymentMethod, ProductType } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import { nextTenantSequence } from "../../shared/persistence/tenant-sequence.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { recordInventoryTracking } from "../inventory/inventory-tracking.js"
import { allocateDiscount, quantityMatchesScale } from "./sales-calculations.js"
import type {
  CreateReturnInput,
  CreateSaleInput,
  Sale,
  SaleReturn,
} from "./types.js"

export interface SalesRepository {
  get(tenantId: string, id: string): Promise<Sale | null>
  create(
    user: AuthenticatedUser,
    input: CreateSaleInput,
    key: string,
    hash: string,
  ): Promise<Sale>
  cancel(
    user: AuthenticatedUser,
    saleId: string,
    input: { version: number; reason: string },
    key: string,
    hash: string,
  ): Promise<Sale>
  createReturn(
    user: AuthenticatedUser,
    saleId: string,
    input: CreateReturnInput,
    key: string,
    hash: string,
  ): Promise<SaleReturn>
}

interface ProductRow {
  id: string
  name: string
  type: ProductType
  current_price_cents: number
  current_cost_cents: number | null
  abbreviation: string
  quantity_scale: number
}

interface PreparedLine {
  key: string
  productId: string | null
  serviceOrderId: string | null
  serviceOrderPreviousColumnId: string | null
  product: ProductRow
  quantity: number
  grossAmountCents: number
}

function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

async function currentSession(
  database: Kysely<Database>,
  user: AuthenticatedUser,
): Promise<{ id: string }> {
  const session = await database.selectFrom("cash_sessions as session")
    .innerJoin("cash_register_assignments as assignment", (join) => join
      .onRef("assignment.cash_register_id", "=", "session.cash_register_id")
      .onRef("assignment.user_id", "=", "session.opening_operator_id")
      .on("assignment.valid_until", "is", null))
    .select("session.id")
    .where("session.tenant_id", "=", user.tenantId)
    .where("session.opening_operator_id", "=", user.id)
    .where("session.status", "=", "open")
    .forUpdate()
    .executeTakeFirst()
  if (!session) {
    throw new AppError(
      409,
      "OPEN_CASH_SESSION_REQUIRED",
      "An assigned open cash session is required.",
    )
  }
  return session
}

async function ensureCashAvailable(
  database: Kysely<Database>,
  tenantId: string,
  sessionId: string,
  requiredAmountCents: number,
): Promise<void> {
  if (requiredAmountCents === 0) return
  const total = await database.selectFrom("cash_movements")
    .select((expression) => expression.fn.coalesce(
      expression.fn.sum<string>("amount_cents"),
      sql<string>`0`,
    ).as("amount"))
    .where("tenant_id", "=", tenantId)
    .where("cash_session_id", "=", sessionId)
    .where("payment_method", "=", "cash").executeTakeFirstOrThrow()
  if (Number(total.amount) < requiredAmountCents) {
    throw new AppError(
      409,
      "INSUFFICIENT_CASH",
      "The current session does not have enough cash for this reversal.",
    )
  }
}

function requireSafeMoney(value: number, code: string, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(400, code, message)
  }
}

export class KyselySalesRepository implements SalesRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async get(tenantId: string, id: string): Promise<Sale | null> {
    const row = await this.database.selectFrom("sales as sale")
      .innerJoin("users as operator", "operator.id", "sale.operator_id")
      .select([
        "sale.id", "sale.business_number", "sale.status", "sale.customer_id",
        "sale.customer_name_snapshot", "operator.id as operator_id",
        "operator.name as operator_name", "sale.cash_session_id",
        "sale.gross_amount_cents", "sale.discount_amount_cents",
        "sale.net_amount_cents", "sale.returned_amount_cents",
        "sale.change_amount_cents", "sale.business_date", "sale.completed_at",
        "sale.cancelled_at", "sale.cancellation_reason", "sale.version",
      ])
      .where("sale.tenant_id", "=", tenantId)
      .where("sale.id", "=", id)
      .executeTakeFirst()
    if (!row) return null

    const [items, payments, returnIds] = await Promise.all([
      this.database.selectFrom("sale_items").select([
        "id", "product_id", "service_order_id", "product_name_snapshot", "product_type_snapshot",
        "unit_abbreviation_snapshot", "quantity", "unit_price_cents",
        "gross_amount_cents", "allocated_discount_cents", "net_amount_cents",
        "unit_cost_snapshot_cents", "returned_quantity", "returned_net_amount_cents",
      ]).where("tenant_id", "=", tenantId).where("sale_id", "=", id)
        .orderBy("created_at").orderBy("id").execute(),
      this.database.selectFrom("payments").select([
        "id", "payment_method", "amount_cents", "effective_amount_cents",
        "installments", "status", "external_reference",
      ]).where("tenant_id", "=", tenantId).where("sale_id", "=", id)
        .orderBy("created_at").orderBy("id").execute(),
      this.database.selectFrom("sale_returns").select("id")
        .where("tenant_id", "=", tenantId).where("sale_id", "=", id)
        .orderBy("completed_at").orderBy("id").execute(),
    ])
    const returns = await Promise.all(returnIds.map(({ id: returnId }) =>
      this.getReturn(tenantId, returnId)
    ))

    return {
      id: row.id,
      businessNumber: Number(row.business_number),
      status: row.status,
      customer: row.customer_id && row.customer_name_snapshot
        ? { id: row.customer_id, name: row.customer_name_snapshot }
        : null,
      operator: { id: row.operator_id, name: row.operator_name },
      cashSessionId: row.cash_session_id,
      grossAmountCents: Number(row.gross_amount_cents),
      discountAmountCents: Number(row.discount_amount_cents),
      netAmountCents: Number(row.net_amount_cents),
      returnedAmountCents: Number(row.returned_amount_cents),
      changeAmountCents: Number(row.change_amount_cents),
      businessDate: row.business_date,
      completedAt: row.completed_at.toISOString(),
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
      cancellationReason: row.cancellation_reason,
      version: row.version,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        serviceOrderId: item.service_order_id,
        productName: item.product_name_snapshot,
        productType: item.product_type_snapshot,
        unitAbbreviation: item.unit_abbreviation_snapshot,
        quantity: Number(item.quantity),
        unitPriceCents: item.unit_price_cents,
        grossAmountCents: Number(item.gross_amount_cents),
        allocatedDiscountCents: Number(item.allocated_discount_cents),
        netAmountCents: Number(item.net_amount_cents),
        unitCostSnapshotCents: item.unit_cost_snapshot_cents === null
          ? null : Number(item.unit_cost_snapshot_cents),
        returnedQuantity: Number(item.returned_quantity),
        returnedNetAmountCents: Number(item.returned_net_amount_cents),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        method: payment.payment_method,
        amountCents: Number(payment.amount_cents),
        effectiveAmountCents: Number(payment.effective_amount_cents),
        installments: payment.installments,
        status: payment.status,
        externalReference: payment.external_reference,
      })),
      returns,
    }
  }

  private async getReturn(tenantId: string, id: string): Promise<SaleReturn> {
    const row = await this.database.selectFrom("sale_returns as return")
      .innerJoin("users as operator", "operator.id", "return.operator_id")
      .select([
        "return.id", "return.business_number", "return.reason",
        "return.total_amount_cents", "operator.id as operator_id",
        "operator.name as operator_name", "return.cash_session_id",
        "return.completed_at",
      ]).where("return.tenant_id", "=", tenantId).where("return.id", "=", id)
      .executeTakeFirstOrThrow()
    const [items, refunds] = await Promise.all([
      this.database.selectFrom("sale_return_items").select([
        "id", "sale_item_id", "quantity", "amount_cents", "restock",
        "unit_cost_snapshot_cents", "stock_movement_id",
      ]).where("tenant_id", "=", tenantId).where("return_id", "=", id)
        .orderBy("created_at").orderBy("id").execute(),
      this.database.selectFrom("sale_return_refunds").select([
        "payment_method", "amount_cents", "external_reference",
      ]).where("tenant_id", "=", tenantId).where("return_id", "=", id)
        .orderBy("created_at").orderBy("id").execute(),
    ])
    return {
      id: row.id,
      businessNumber: Number(row.business_number),
      reason: row.reason,
      totalAmountCents: Number(row.total_amount_cents),
      operator: { id: row.operator_id, name: row.operator_name },
      cashSessionId: row.cash_session_id,
      completedAt: row.completed_at.toISOString(),
      items: items.map((item) => ({
        id: item.id,
        saleItemId: item.sale_item_id,
        quantity: Number(item.quantity),
        amountCents: Number(item.amount_cents),
        restock: item.restock,
        unitCostSnapshotCents: item.unit_cost_snapshot_cents === null
          ? null : Number(item.unit_cost_snapshot_cents),
        stockMovementId: item.stock_movement_id,
      })),
      refunds: refunds.map((refund) => ({
        method: refund.payment_method,
        amountCents: Number(refund.amount_cents),
        externalReference: refund.external_reference,
      })),
    }
  }

  async create(
    user: AuthenticatedUser,
    input: CreateSaleInput,
    key: string,
    hash: string,
  ): Promise<Sale> {
    const route = "POST /api/v1/sales"
    const saleId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await currentSession(transaction, user)
      const requestedCustomer = input.customerId
        ? await transaction.selectFrom("customers").select(["id", "name"])
          .where("tenant_id", "=", user.tenantId).where("id", "=", input.customerId)
          .where("status", "=", "active").where("archived_at", "is", null)
          .executeTakeFirst()
        : null
      if (input.customerId && !requestedCustomer) {
        throw new AppError(409, "CUSTOMER_UNAVAILABLE", "Customer is unavailable.")
      }

      const productInputs = input.items.filter((
        item,
      ): item is { productId: string; quantity: number } => "productId" in item)
      const serviceOrderInputs = input.items.filter((
        item,
      ): item is { serviceOrderId: string } => "serviceOrderId" in item)
      const productIds = productInputs.map((item) => item.productId).sort()
      const serviceOrderIds = serviceOrderInputs.map((item) => item.serviceOrderId).sort()
      const products = productIds.length === 0 ? [] : await transaction
        .selectFrom("products as product")
        .innerJoin("units as unit", "unit.id", "product.unit_id")
        .select([
          "product.id", "product.name", "product.type", "product.current_price_cents",
          "product.current_cost_cents", "unit.abbreviation", "unit.quantity_scale",
        ]).where("product.tenant_id", "=", user.tenantId)
        .where("product.id", "in", productIds)
        .where("product.active", "=", true).where("product.archived_at", "is", null)
        .orderBy("product.id").forUpdate("product").execute() as ProductRow[]
      if (products.length !== productIds.length) {
        throw new AppError(409, "SALE_PRODUCT_UNAVAILABLE", "A sale product is unavailable.")
      }
      const serviceOrders = serviceOrderIds.length === 0 ? [] : await transaction
        .selectFrom("service_orders as service_order")
        .innerJoin("service_order_columns as current_column", (join) => join
          .onRef("current_column.id", "=", "service_order.current_column_id")
          .onRef("current_column.tenant_id", "=", "service_order.tenant_id"))
        .select([
          "service_order.id", "service_order.customer_id",
          "service_order.customer_name_snapshot", "service_order.title",
          "service_order.estimated_value_cents", "service_order.current_column_id",
          "service_order.current_status", "service_order.final_sale_id",
          "current_column.ready_for_sale",
        ]).where("service_order.tenant_id", "=", user.tenantId)
        .where("service_order.id", "in", serviceOrderIds)
        .orderBy("service_order.id").forUpdate("service_order").execute()
      if (serviceOrders.length !== serviceOrderIds.length
        || serviceOrders.some((order) =>
          order.current_status !== "open"
          || !order.ready_for_sale
          || order.final_sale_id !== null
        )) {
        throw new AppError(
          409,
          "SERVICE_ORDER_UNAVAILABLE",
          "A service order must be ready for sale and not previously billed.",
        )
      }
      const orderCustomerIds = new Set(serviceOrders.map((order) => order.customer_id))
      if (orderCustomerIds.size > 1
        || (requestedCustomer
          && orderCustomerIds.size === 1
          && !orderCustomerIds.has(requestedCustomer.id))) {
        throw new AppError(
          409,
          "SERVICE_ORDER_CUSTOMER_MISMATCH",
          "All service orders in a sale must belong to the selected customer.",
        )
      }
      const orderCustomer = serviceOrders[0]
        ? {
            id: serviceOrders[0].customer_id,
            name: serviceOrders[0].customer_name_snapshot,
          }
        : null
      const customer = requestedCustomer ?? orderCustomer
      const productById = new Map(products.map((product) => [product.id, product]))
      const preparedProducts: PreparedLine[] = productInputs.map((item) => {
        const product = productById.get(item.productId)
        if (!product) throw new Error("Validated product disappeared")
        if (!quantityMatchesScale(item.quantity, product.quantity_scale)) {
          throw new AppError(
            400,
            "INVALID_QUANTITY_SCALE",
            `Quantity for ${product.name} exceeds its unit precision.`,
          )
        }
        const grossAmountCents = Math.round(product.current_price_cents * item.quantity)
        requireSafeMoney(grossAmountCents, "INVALID_LINE_TOTAL", "A sale line total is invalid.")
        return {
          key: `product:${item.productId}`,
          productId: item.productId,
          serviceOrderId: null,
          serviceOrderPreviousColumnId: null,
          product,
          quantity: item.quantity,
          grossAmountCents,
        }
      })
      const preparedOrders: PreparedLine[] = serviceOrders.map((order) => ({
        key: `order:${order.id}`,
        productId: null,
        serviceOrderId: order.id,
        serviceOrderPreviousColumnId: order.current_column_id,
        product: {
          id: order.id,
          name: order.title,
          type: "service",
          current_price_cents: Number(order.estimated_value_cents),
          current_cost_cents: null,
          abbreviation: "serv",
          quantity_scale: 0,
        },
        quantity: 1,
        grossAmountCents: Number(order.estimated_value_cents),
      }))
      const prepared = [...preparedProducts, ...preparedOrders]
        .sort((left, right) => left.key.localeCompare(right.key))
      const grossAmountCents = prepared.reduce((sum, item) => sum + item.grossAmountCents, 0)
      const discountAmountCents = input.discountAmountCents ?? 0
      const changeAmountCents = input.changeAmountCents ?? 0
      requireSafeMoney(grossAmountCents, "INVALID_SALE_TOTAL", "Sale total is invalid.")
      requireSafeMoney(changeAmountCents, "INVALID_CHANGE", "Cash change is invalid.")
      const discounts = allocateDiscount(prepared.map((item) => ({
        key: item.key,
        grossAmountCents: item.grossAmountCents,
      })), discountAmountCents)
      const netAmountCents = grossAmountCents - discountAmountCents
      const tendered = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
      const cashTendered = input.payments
        .filter((payment) => payment.method === "cash")
        .reduce((sum, payment) => sum + payment.amountCents, 0)
      if (!Number.isSafeInteger(tendered)
        || tendered !== netAmountCents + changeAmountCents
        || changeAmountCents > cashTendered) {
        throw new AppError(
          400,
          "PAYMENT_TOTAL_MISMATCH",
          "Payments must equal the net sale amount plus cash change.",
        )
      }

      const stockItems = prepared.filter((
        item,
      ): item is PreparedLine & { productId: string } =>
        item.productId !== null && item.product.type !== "service"
      )
      const balances = stockItems.length === 0 ? [] : await transaction
        .selectFrom("inventory_balances").select([
          "product_id", "on_hand", "reserved", "average_unit_cost_cents",
        ]).where("tenant_id", "=", user.tenantId)
        .where("product_id", "in", stockItems.map((item) => item.productId).sort())
        .orderBy("product_id").forUpdate().execute()
      const balanceByProduct = new Map(balances.map((balance) => [balance.product_id, balance]))
      for (const item of stockItems) {
        const balance = balanceByProduct.get(item.productId)
        if (!balance || Number(balance.on_hand) - Number(balance.reserved) < item.quantity) {
          throw new AppError(
            409,
            "INSUFFICIENT_STOCK",
            `Insufficient available stock for ${item.product.name}.`,
          )
        }
      }

      const completedAt = new Date()
      const setting = await transaction.selectFrom("tenant_settings").select("timezone")
        .where("tenant_id", "=", user.tenantId).executeTakeFirstOrThrow()
      const businessNumber = await nextTenantSequence(transaction, user.tenantId, "sale")
      const saleReference = String(businessNumber)
      const sale = await transaction.insertInto("sales").values({
        tenant_id: user.tenantId,
        business_number: businessNumber,
        status: "completed",
        customer_id: customer?.id ?? null,
        customer_name_snapshot: customer?.name ?? null,
        operator_id: user.id,
        cash_session_id: session.id,
        gross_amount_cents: grossAmountCents,
        discount_amount_cents: discountAmountCents,
        net_amount_cents: netAmountCents,
        returned_amount_cents: 0,
        change_amount_cents: changeAmountCents,
        business_date: localDate(completedAt, setting.timezone),
        completed_at: completedAt,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_reason: null,
      }).returning("id").executeTakeFirstOrThrow()

      let remainingChange = changeAmountCents
      for (const payment of input.payments) {
        const changeForPayment = payment.method === "cash"
          ? Math.min(payment.amountCents, remainingChange)
          : 0
        remainingChange -= changeForPayment
        const effectiveAmountCents = payment.amountCents - changeForPayment
        await transaction.insertInto("payments").values({
          tenant_id: user.tenantId,
          sale_id: sale.id,
          payment_method: payment.method,
          amount_cents: payment.amountCents,
          effective_amount_cents: effectiveAmountCents,
          installments: payment.method === "credit" ? payment.installments ?? 1 : null,
          status: "completed",
          external_reference: payment.externalReference ?? null,
        }).execute()
        if (effectiveAmountCents > 0) {
          await transaction.insertInto("cash_movements").values({
            tenant_id: user.tenantId,
            cash_session_id: session.id,
            movement_type: "sale",
            payment_method: payment.method,
            amount_cents: effectiveAmountCents,
            source_type: "sale",
            source_id: sale.id,
            actor_user_id: user.id,
            reason: `Sale ${saleReference}.`,
            reversal_of_id: null,
            occurred_at: completedAt,
          }).execute()
        }
      }

      const completedColumn = preparedOrders.length === 0 ? null : await transaction
        .selectFrom("service_order_columns").select("id")
        .where("tenant_id", "=", user.tenantId)
        .where("semantic_type", "=", "completed")
        .where("archived_at", "is", null).executeTakeFirst()
      if (preparedOrders.length > 0 && !completedColumn) {
        throw new AppError(
          409,
          "COMPLETED_COLUMN_REQUIRED",
          "The protected completed service-order column is missing.",
        )
      }
      for (const item of prepared) {
        const discount = discounts.get(item.key) ?? 0
        const saleItem = await transaction.insertInto("sale_items").values({
          tenant_id: user.tenantId,
          sale_id: sale.id,
          product_id: item.productId,
          product_name_snapshot: item.product.name,
          product_type_snapshot: item.product.type,
          unit_abbreviation_snapshot: item.product.abbreviation,
          quantity: item.quantity,
          unit_price_cents: item.product.current_price_cents,
          gross_amount_cents: item.grossAmountCents,
          allocated_discount_cents: discount,
          net_amount_cents: item.grossAmountCents - discount,
          unit_cost_snapshot_cents: item.product.type === "service"
            ? item.product.current_cost_cents
            : item.productId
              ? balanceByProduct.get(item.productId)?.average_unit_cost_cents ?? null
              : null,
          returned_quantity: 0,
          returned_net_amount_cents: 0,
          service_order_id: item.serviceOrderId,
          service_order_previous_column_id: item.serviceOrderPreviousColumnId,
        }).returning("id").executeTakeFirstOrThrow()
        if (item.serviceOrderId && item.serviceOrderPreviousColumnId && completedColumn) {
          const billed = await transaction.updateTable("service_orders").set({
            final_sale_id: sale.id,
            current_column_id: completedColumn.id,
            current_status: "completed",
            completed_at: completedAt,
            cancelled_at: null,
            updated_by: user.id,
            updated_at: completedAt,
            version: sql`version + 1`,
          }).where("tenant_id", "=", user.tenantId)
            .where("id", "=", item.serviceOrderId)
            .where("current_status", "=", "open")
            .where("final_sale_id", "is", null)
            .returning("id").executeTakeFirst()
          if (!billed) {
            throw new AppError(
              409,
              "SERVICE_ORDER_ALREADY_BILLED",
              "A service order was billed concurrently.",
            )
          }
          await transaction.insertInto("service_order_status_history").values({
            tenant_id: user.tenantId,
            service_order_id: item.serviceOrderId,
            previous_column_id: item.serviceOrderPreviousColumnId,
            new_column_id: completedColumn.id,
            previous_status: "open",
            new_status: "completed",
            actor_user_id: user.id,
            occurred_at: completedAt,
            reason: `Billed in sale ${saleReference}.`,
            metadata: { saleId: sale.id },
          }).execute()
        }
        if (item.product.type === "service") continue
        if (!item.productId) throw new Error("Stock item has no product")
        const balance = balanceByProduct.get(item.productId)
        if (!balance) throw new Error("Locked inventory balance disappeared")
        const oldOnHand = Number(balance.on_hand)
        const reserved = Number(balance.reserved)
        const newOnHand = oldOnHand - item.quantity
        await transaction.updateTable("inventory_balances").set({
          on_hand: newOnHand,
          version: sql`version + 1`,
          updated_at: completedAt,
        }).where("tenant_id", "=", user.tenantId)
          .where("product_id", "=", item.productId).execute()
        const movement = await transaction.insertInto("stock_movements").values({
          tenant_id: user.tenantId,
          product_id: item.productId,
          movement_type: "sale",
          quantity: -item.quantity,
          resulting_on_hand: newOnHand,
          resulting_reserved: reserved,
          unit_cost_snapshot_cents: balance.average_unit_cost_cents,
          source_type: "sale_item",
          source_id: saleItem.id,
          source_reference: saleReference,
          reason: `Sale ${saleReference}.`,
          actor_user_id: user.id,
          occurred_at: completedAt,
          reversal_of_id: null,
        }).returning("id").executeTakeFirstOrThrow()
        await recordInventoryTracking(transaction, {
          tenantId: user.tenantId,
          productId: item.productId,
          movementId: movement.id,
          movementType: "sale",
          quantity: -item.quantity,
          oldOnHand,
          newOnHand,
          reserved,
          occurredAt: completedAt,
        })
      }

      await transaction.updateTable("cash_sessions").set({
        version: sql`version + 1`, updated_at: completedAt,
      }).where("id", "=", session.id).execute()
      await recordDomainEvent(transaction, user, {
        action: "sale.completed",
        entityType: "sale",
        entityId: sale.id,
        after: { businessNumber, grossAmountCents, discountAmountCents, netAmountCents },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, sale.id, 201)
      return sale.id
    })
    const sale = await this.get(user.tenantId, saleId)
    if (!sale) throw new Error("Created sale could not be reloaded")
    return sale
  }

  async cancel(
    user: AuthenticatedUser,
    saleId: string,
    input: { version: number; reason: string },
    key: string,
    hash: string,
  ): Promise<Sale> {
    const route = `POST /api/v1/sales/${saleId}/cancel`
    const resultId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await currentSession(transaction, user)
      const sale = await transaction.selectFrom("sales").select([
        "id", "business_number", "status", "version", "returned_amount_cents",
      ]).where("tenant_id", "=", user.tenantId).where("id", "=", saleId)
        .forUpdate().executeTakeFirst()
      if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale was not found.")
      if (sale.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "Sale changed. Reload and retry.")
      }
      if (sale.status !== "completed" || Number(sale.returned_amount_cents) !== 0) {
        throw new AppError(409, "SALE_CANNOT_BE_CANCELLED", "Only an untouched sale can be cancelled.")
      }
      const items = await transaction.selectFrom("sale_items").select([
        "id", "product_id", "product_type_snapshot", "quantity",
        "unit_cost_snapshot_cents", "service_order_id",
        "service_order_previous_column_id",
      ]).where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId)
        .orderBy("product_id").execute()
      const stockItems = items.filter((
        item,
      ): item is typeof item & { product_id: string } =>
        item.product_type_snapshot !== "service" && item.product_id !== null
      )
      const balances = stockItems.length === 0 ? [] : await transaction
        .selectFrom("inventory_balances").select([
          "product_id", "on_hand", "reserved", "average_unit_cost_cents",
        ]).where("tenant_id", "=", user.tenantId)
        .where("product_id", "in", stockItems.map((item) => item.product_id))
        .orderBy("product_id").forUpdate().execute()
      const balanceByProduct = new Map(balances.map((balance) => [balance.product_id, balance]))
      const occurredAt = new Date()
      for (const item of stockItems) {
        const balance = balanceByProduct.get(item.product_id)
        if (!balance) throw new Error("Sale inventory balance disappeared")
        const quantity = Number(item.quantity)
        const oldOnHand = Number(balance.on_hand)
        const newOnHand = oldOnHand + quantity
        const unitCost = item.unit_cost_snapshot_cents
        const oldCost = balance.average_unit_cost_cents
        const newAverage = unitCost === null || (oldOnHand > 0 && oldCost === null)
          ? null
          : oldOnHand === 0
            ? Number(unitCost)
            : ((oldOnHand * Number(oldCost)) + (quantity * Number(unitCost))) / newOnHand
        await transaction.updateTable("inventory_balances").set({
          on_hand: newOnHand,
          average_unit_cost_cents: newAverage,
          version: sql`version + 1`,
          updated_at: occurredAt,
        }).where("tenant_id", "=", user.tenantId)
          .where("product_id", "=", item.product_id).execute()
        const original = await transaction.selectFrom("stock_movements").select("id")
          .where("tenant_id", "=", user.tenantId).where("source_type", "=", "sale_item")
          .where("source_id", "=", item.id).where("movement_type", "=", "sale")
          .executeTakeFirstOrThrow()
        const movement = await transaction.insertInto("stock_movements").values({
          tenant_id: user.tenantId,
          product_id: item.product_id,
          movement_type: "sale_reversal",
          quantity,
          resulting_on_hand: newOnHand,
          resulting_reserved: Number(balance.reserved),
          unit_cost_snapshot_cents: unitCost,
          source_type: "sale_cancellation",
          source_id: saleId,
          source_reference: sale.business_number,
          reason: input.reason,
          actor_user_id: user.id,
          occurred_at: occurredAt,
          reversal_of_id: original.id,
        }).returning("id").executeTakeFirstOrThrow()
        await recordInventoryTracking(transaction, {
          tenantId: user.tenantId,
          productId: item.product_id,
          movementId: movement.id,
          movementType: "sale_reversal",
          quantity,
          oldOnHand,
          newOnHand,
          reserved: Number(balance.reserved),
          occurredAt,
        })
      }
      const serviceItems = items.filter((
        item,
      ): item is typeof item & {
        service_order_id: string
        service_order_previous_column_id: string
      } => item.service_order_id !== null && item.service_order_previous_column_id !== null)
      for (const item of serviceItems) {
        const order = await transaction.selectFrom("service_orders").select([
          "current_column_id", "current_status", "final_sale_id",
        ]).where("tenant_id", "=", user.tenantId)
          .where("id", "=", item.service_order_id).forUpdate().executeTakeFirst()
        if (!order
          || order.final_sale_id !== saleId
          || order.current_status !== "completed") {
          throw new AppError(
            409,
            "SERVICE_ORDER_CANCELLATION_CONFLICT",
            "A billed service order no longer matches the sale.",
          )
        }
        await transaction.updateTable("service_orders").set({
          final_sale_id: null,
          current_column_id: item.service_order_previous_column_id,
          current_status: "open",
          completed_at: null,
          cancelled_at: null,
          updated_by: user.id,
          updated_at: occurredAt,
          version: sql`version + 1`,
        }).where("id", "=", item.service_order_id).execute()
        await transaction.insertInto("service_order_status_history").values({
          tenant_id: user.tenantId,
          service_order_id: item.service_order_id,
          previous_column_id: order.current_column_id,
          new_column_id: item.service_order_previous_column_id,
          previous_status: "completed",
          new_status: "open",
          actor_user_id: user.id,
          occurred_at: occurredAt,
          reason: input.reason,
          metadata: { cancelledSaleId: saleId },
        }).execute()
      }
      const payments = await transaction.selectFrom("payments").select([
        "id", "payment_method", "effective_amount_cents",
      ]).where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId).execute()
      const cashReversal = payments
        .filter((payment) => payment.payment_method === "cash")
        .reduce((sum, payment) => sum + Number(payment.effective_amount_cents), 0)
      await ensureCashAvailable(
        transaction, user.tenantId, session.id, cashReversal,
      )
      for (const payment of payments) {
        const amount = Number(payment.effective_amount_cents)
        if (amount > 0) {
          await transaction.insertInto("cash_movements").values({
            tenant_id: user.tenantId,
            cash_session_id: session.id,
            movement_type: "sale_reversal",
            payment_method: payment.payment_method,
            amount_cents: -amount,
            source_type: "sale_cancellation",
            source_id: saleId,
            actor_user_id: user.id,
            reason: input.reason,
            reversal_of_id: null,
            occurred_at: occurredAt,
          }).execute()
        }
      }
      await transaction.updateTable("payments").set({ status: "reversed" })
        .where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId).execute()
      await transaction.updateTable("sales").set({
        status: "cancelled",
        cancelled_by: user.id,
        cancelled_at: occurredAt,
        cancellation_reason: input.reason,
        version: sql`version + 1`,
        updated_at: occurredAt,
      }).where("id", "=", saleId).execute()
      await transaction.updateTable("cash_sessions").set({
        version: sql`version + 1`, updated_at: occurredAt,
      }).where("id", "=", session.id).execute()
      await recordDomainEvent(transaction, user, {
        action: "sale.cancelled", entityType: "sale", entityId: saleId,
        reason: input.reason, after: { status: "cancelled" },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, saleId, 200)
      return saleId
    })
    const sale = await this.get(user.tenantId, resultId)
    if (!sale) throw new Error("Cancelled sale could not be reloaded")
    return sale
  }

  async createReturn(
    user: AuthenticatedUser,
    saleId: string,
    input: CreateReturnInput,
    key: string,
    hash: string,
  ): Promise<SaleReturn> {
    const route = `POST /api/v1/sales/${saleId}/returns`
    const returnId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await currentSession(transaction, user)
      const sale = await transaction.selectFrom("sales").select([
        "id", "business_number", "status", "net_amount_cents", "returned_amount_cents",
      ]).where("tenant_id", "=", user.tenantId).where("id", "=", saleId)
        .forUpdate().executeTakeFirst()
      if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale was not found.")
      if (sale.status === "cancelled" || sale.status === "returned") {
        throw new AppError(409, "SALE_CANNOT_BE_RETURNED", "Sale is not eligible for another return.")
      }
      const requestedIds = input.items.map((item) => item.saleItemId).sort()
      const items = await transaction.selectFrom("sale_items as item")
        .leftJoin("products as product", "product.id", "item.product_id")
        .leftJoin("units as unit", "unit.id", "product.unit_id")
        .select([
          "item.id", "item.product_id", "item.product_name_snapshot",
          "item.product_type_snapshot", "item.quantity", "item.net_amount_cents",
          "item.returned_quantity", "item.returned_net_amount_cents",
          "item.unit_cost_snapshot_cents", "unit.quantity_scale",
        ]).where("item.tenant_id", "=", user.tenantId)
        .where("item.sale_id", "=", saleId).where("item.id", "in", requestedIds)
        .orderBy("item.id").forUpdate("item").execute()
      if (items.length !== requestedIds.length) {
        throw new AppError(400, "INVALID_RETURN_ITEM", "A return item is not part of the sale.")
      }
      const requestedById = new Map(input.items.map((item) => [item.saleItemId, item]))
      const prepared = items.map((item) => {
        const requested = requestedById.get(item.id)
        if (!requested) throw new Error("Validated return item disappeared")
        if (!quantityMatchesScale(requested.quantity, item.quantity_scale ?? 0)) {
          throw new AppError(
            400,
            "INVALID_QUANTITY_SCALE",
            `Return quantity for ${item.product_name_snapshot} exceeds its unit precision.`,
          )
        }
        if (item.product_type_snapshot === "service" && requested.restock) {
          throw new AppError(400, "SERVICE_CANNOT_BE_RESTOCKED", "A service cannot be restocked.")
        }
        const sold = Number(item.quantity)
        const alreadyReturned = Number(item.returned_quantity)
        if (requested.quantity > sold - alreadyReturned + 1e-8) {
          throw new AppError(
            409,
            "RETURN_QUANTITY_EXCEEDED",
            `Return quantity exceeds the remaining quantity for ${item.product_name_snapshot}.`,
          )
        }
        const scaleFactor = 10 ** (item.quantity_scale ?? 0)
        const newReturnedQuantity = Math.round(
          (alreadyReturned + requested.quantity) * scaleFactor,
        ) / scaleFactor
        const remainingNet = Number(item.net_amount_cents)
          - Number(item.returned_net_amount_cents)
        const amountCents = Math.abs(newReturnedQuantity - sold) < 1e-8
          ? remainingNet
          : Math.round((Number(item.net_amount_cents) * requested.quantity) / sold)
        return { ...item, ...requested, newReturnedQuantity, amountCents }
      })
      const total = prepared.reduce((sum, item) => sum + item.amountCents, 0)
      const refundsTotal = input.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
      if (!Number.isSafeInteger(refundsTotal) || refundsTotal !== total) {
        throw new AppError(
          400,
          "REFUND_TOTAL_MISMATCH",
          "Refund methods must equal the calculated return total.",
        )
      }
      const cashRefund = input.refunds
        .filter((refund) => refund.method === "cash")
        .reduce((sum, refund) => sum + refund.amountCents, 0)
      await ensureCashAvailable(
        transaction, user.tenantId, session.id, cashRefund,
      )
      const paymentTotals = await transaction.selectFrom("payments")
        .select([
          "payment_method",
          (expression) => expression.fn.sum<string>("effective_amount_cents").as("amount"),
        ]).where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId)
        .groupBy("payment_method").execute()
      const priorRefunds = await transaction.selectFrom("sale_return_refunds as refund")
        .innerJoin("sale_returns as return", "return.id", "refund.return_id")
        .select([
          "refund.payment_method",
          (expression) => expression.fn.sum<string>("refund.amount_cents").as("amount"),
        ]).where("return.tenant_id", "=", user.tenantId).where("return.sale_id", "=", saleId)
        .groupBy("refund.payment_method").execute()
      const paidByMethod = new Map(paymentTotals.map((item) => [
        item.payment_method, Number(item.amount),
      ]))
      const refundedByMethod = new Map(priorRefunds.map((item) => [
        item.payment_method, Number(item.amount),
      ]))
      for (const method of ["cash", "credit", "debit", "pix"] as PaymentMethod[]) {
        const requested = input.refunds.filter((refund) => refund.method === method)
          .reduce((sum, refund) => sum + refund.amountCents, 0)
        if ((refundedByMethod.get(method) ?? 0) + requested > (paidByMethod.get(method) ?? 0)) {
          throw new AppError(
            409,
            "REFUND_METHOD_EXCEEDED",
            `Refund exceeds the amount originally paid by ${method}.`,
          )
        }
      }

      const restocked = prepared.filter((
        item,
      ): item is typeof item & { product_id: string } =>
        item.restock && item.product_id !== null
      )
      const balances = restocked.length === 0 ? [] : await transaction
        .selectFrom("inventory_balances").select([
          "product_id", "on_hand", "reserved", "average_unit_cost_cents",
        ]).where("tenant_id", "=", user.tenantId)
        .where("product_id", "in", restocked.map((item) => item.product_id).sort())
        .orderBy("product_id").forUpdate().execute()
      const balanceByProduct = new Map(balances.map((balance) => [balance.product_id, balance]))
      if (balances.length !== restocked.length) {
        throw new AppError(409, "RETURN_STOCK_UNAVAILABLE", "A restock balance is unavailable.")
      }
      const completedAt = new Date()
      const businessNumber = await nextTenantSequence(transaction, user.tenantId, "sale_return")
      const createdReturn = await transaction.insertInto("sale_returns").values({
        tenant_id: user.tenantId,
        business_number: businessNumber,
        sale_id: saleId,
        operator_id: user.id,
        cash_session_id: session.id,
        reason: input.reason,
        total_amount_cents: total,
        status: "completed",
        completed_at: completedAt,
      }).returning("id").executeTakeFirstOrThrow()

      for (const item of prepared) {
        let movementId: string | null = null
        if (item.restock) {
          if (!item.product_id) {
            throw new AppError(400, "SERVICE_CANNOT_BE_RESTOCKED", "A service cannot be restocked.")
          }
          const balance = balanceByProduct.get(item.product_id)
          if (!balance) throw new Error("Locked return balance disappeared")
          const oldOnHand = Number(balance.on_hand)
          const newOnHand = oldOnHand + item.quantity
          const unitCost = item.unit_cost_snapshot_cents
          const oldCost = balance.average_unit_cost_cents
          const newAverage = unitCost === null || (oldOnHand > 0 && oldCost === null)
            ? null
            : oldOnHand === 0
              ? Number(unitCost)
              : ((oldOnHand * Number(oldCost)) + (item.quantity * Number(unitCost))) / newOnHand
          await transaction.updateTable("inventory_balances").set({
            on_hand: newOnHand,
            average_unit_cost_cents: newAverage,
            version: sql`version + 1`,
            updated_at: completedAt,
          }).where("tenant_id", "=", user.tenantId)
            .where("product_id", "=", item.product_id).execute()
          const movement = await transaction.insertInto("stock_movements").values({
            tenant_id: user.tenantId,
            product_id: item.product_id,
            movement_type: "return",
            quantity: item.quantity,
            resulting_on_hand: newOnHand,
            resulting_reserved: Number(balance.reserved),
            unit_cost_snapshot_cents: unitCost,
            source_type: "sale_return",
            source_id: createdReturn.id,
            source_reference: String(businessNumber),
            reason: input.reason,
            actor_user_id: user.id,
            occurred_at: completedAt,
            reversal_of_id: null,
          }).returning("id").executeTakeFirstOrThrow()
          movementId = movement.id
          await recordInventoryTracking(transaction, {
            tenantId: user.tenantId,
            productId: item.product_id,
            movementId,
            movementType: "return",
            quantity: item.quantity,
            oldOnHand,
            newOnHand,
            reserved: Number(balance.reserved),
            occurredAt: completedAt,
          })
        }
        await transaction.insertInto("sale_return_items").values({
          tenant_id: user.tenantId,
          return_id: createdReturn.id,
          sale_item_id: item.id,
          quantity: item.quantity,
          amount_cents: item.amountCents,
          restock: item.restock,
          unit_cost_snapshot_cents: item.unit_cost_snapshot_cents,
          stock_movement_id: movementId,
        }).execute()
        await transaction.updateTable("sale_items").set({
          returned_quantity: item.newReturnedQuantity,
          returned_net_amount_cents: Number(item.returned_net_amount_cents) + item.amountCents,
        }).where("id", "=", item.id).execute()
      }
      for (const refund of input.refunds) {
        await transaction.insertInto("sale_return_refunds").values({
          tenant_id: user.tenantId,
          return_id: createdReturn.id,
          payment_method: refund.method,
          amount_cents: refund.amountCents,
          external_reference: refund.externalReference ?? null,
        }).execute()
        await transaction.insertInto("cash_movements").values({
          tenant_id: user.tenantId,
          cash_session_id: session.id,
          movement_type: "return",
          payment_method: refund.method,
          amount_cents: -refund.amountCents,
          source_type: "sale_return",
          source_id: createdReturn.id,
          actor_user_id: user.id,
          reason: input.reason,
          occurred_at: completedAt,
          reversal_of_id: null,
        }).execute()
      }
      const returnedAmount = Number(sale.returned_amount_cents) + total
      const unreturnedItem = await transaction.selectFrom("sale_items").select("id")
        .where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId)
        .whereRef("returned_quantity", "<", "quantity").executeTakeFirst()
      await transaction.updateTable("sales").set({
        returned_amount_cents: returnedAmount,
        status: unreturnedItem ? "partially_returned" : "returned",
        version: sql`version + 1`,
        updated_at: completedAt,
      }).where("id", "=", saleId).execute()
      await transaction.updateTable("cash_sessions").set({
        version: sql`version + 1`, updated_at: completedAt,
      }).where("id", "=", session.id).execute()

      const allRefunds = new Map(refundedByMethod)
      for (const refund of input.refunds) {
        allRefunds.set(refund.method, (allRefunds.get(refund.method) ?? 0) + refund.amountCents)
      }
      for (const method of paidByMethod.keys()) {
        const refunded = allRefunds.get(method) ?? 0
        const paid = paidByMethod.get(method) ?? 0
        await transaction.updateTable("payments").set({
          status: refunded >= paid
            ? "refunded" : refunded > 0 ? "partially_refunded" : "completed",
        }).where("tenant_id", "=", user.tenantId).where("sale_id", "=", saleId)
          .where("payment_method", "=", method).execute()
      }
      await recordDomainEvent(transaction, user, {
        action: "sale.returned", entityType: "sale_return",
        aggregateType: "sale", aggregateId: saleId, entityId: createdReturn.id,
        reason: input.reason, after: { saleId, businessNumber, totalAmountCents: total },
      })
      await saveEntityIdempotency(
        transaction, user, route, key, hash, createdReturn.id, 201,
      )
      return createdReturn.id
    })
    return this.getReturn(user.tenantId, returnId)
  }
}
