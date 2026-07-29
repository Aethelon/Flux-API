import { sql } from "kysely"
import { loadConfig } from "../../config/env.js"
import { generateForecasts } from "../../modules/intelligence/forecast-engine.js"
import { generateRecommendations } from "../../modules/intelligence/recommendation-engine.js"
import { createDatabase } from "../client.js"
import type { PaymentMethod } from "../types.js"

const TENANT_SLUG = "dlara"
const DATA_VERSION = "dlara-demo-history-data-v1"
const FINAL_VERSION = "dlara-demo-history-v1"
const paymentMethods: PaymentMethod[] = ["cash", "credit", "debit", "pix"]

function monthStart(offset: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 12))
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

const config = loadConfig()
if (config.nodeEnv === "production") {
  throw new Error("The demonstration history seed cannot run in production")
}

const database = createDatabase(config)

try {
  const tenant = await database.selectFrom("tenants").select("id")
    .where("slug", "=", TENANT_SLUG)
    .where("archived_at", "is", null)
    .executeTakeFirstOrThrow()
  const completed = await database.selectFrom("audit_events").select("id")
    .where("tenant_id", "=", tenant.id)
    .where("action", "=", "demo.history.completed")
    .where("reason", "=", FINAL_VERSION)
    .executeTakeFirst()

  if (completed) {
    console.info("D'lara complementary demonstration history already exists.")
  } else {
    const dataMarker = await database.selectFrom("audit_events").select("id")
      .where("tenant_id", "=", tenant.id)
      .where("action", "=", "demo.history.data.completed")
      .where("reason", "=", DATA_VERSION)
      .executeTakeFirst()

    const inserted = dataMarker
      ? { purchases: 0, sales: 0, serviceOrders: 0 }
      : await database.transaction().execute(async (transaction) => {
          const admin = await transaction.selectFrom("users").select(["id", "name"])
            .where("tenant_id", "=", tenant.id)
            .where("role", "=", "admin")
            .where("status", "=", "active")
            .where("archived_at", "is", null)
            .orderBy("created_at")
            .executeTakeFirstOrThrow()
          const employees = await transaction.selectFrom("users").select(["id", "name"])
            .where("tenant_id", "=", tenant.id)
            .where("role", "=", "funcionario")
            .where("status", "=", "active")
            .where("archived_at", "is", null)
            .orderBy("created_at")
            .execute()
          const operator = employees[0] ?? admin
          const customers = await transaction.selectFrom("customers").select(["id", "name"])
            .where("tenant_id", "=", tenant.id)
            .where("status", "=", "active")
            .where("archived_at", "is", null)
            .orderBy("created_at")
            .execute()
          const products = await transaction.selectFrom("products as product")
            .innerJoin("units as unit", "unit.id", "product.unit_id")
            .leftJoin("inventory_balances as balance", (join) => join
              .onRef("balance.product_id", "=", "product.id")
              .onRef("balance.tenant_id", "=", "product.tenant_id"))
            .select([
              "product.id",
              "product.name",
              "product.type",
              "product.current_price_cents",
              "product.current_cost_cents",
              "unit.abbreviation",
              "balance.on_hand",
              "balance.reserved",
            ])
            .where("product.tenant_id", "=", tenant.id)
            .where("product.sku", "like", "DEMO-%")
            .where("product.active", "=", true)
            .where("product.archived_at", "is", null)
            .orderBy("product.name")
            .execute()
          const stockProducts = products.filter((product) => product.type !== "service")
          const saleProducts = products.filter((product) => (
            product.type === "service"
            || (product.type === "finished_product" && Number(product.on_hand ?? 0) > 0)
          ))
          const supplier = await transaction.selectFrom("suppliers").select("id")
            .where("tenant_id", "=", tenant.id)
            .where("tax_id", "=", "DEMO-DLARA-001")
            .where("archived_at", "is", null)
            .executeTakeFirstOrThrow()
          const supplierLinks = await transaction.selectFrom("product_suppliers")
            .select([
              "product_id",
              "supplier_sku",
              "pack_multiple",
              "minimum_order_quantity",
              "lead_time_days",
            ])
            .where("tenant_id", "=", tenant.id)
            .where("supplier_id", "=", supplier.id)
            .where("active", "=", true)
            .where("valid_until", "is", null)
            .execute()
          const linksByProduct = new Map(supplierLinks.map((link) => [link.product_id, link]))

          if (customers.length < 4 || stockProducts.length < 2 || saleProducts.length < 2) {
            throw new Error("D'lara base demonstration data is incomplete")
          }

          const register = await transaction.selectFrom("cash_registers").select("id")
            .where("tenant_id", "=", tenant.id)
            .where("code", "=", "DEMO-HIST")
            .where("archived_at", "is", null)
            .executeTakeFirst()
            ?? await transaction.insertInto("cash_registers").values({
              tenant_id: tenant.id,
              code: "DEMO-HIST",
              name: "Caixa Histórico",
              active: true,
              created_by: admin.id,
              updated_by: admin.id,
              archived_at: null,
            }).returning("id").executeTakeFirstOrThrow()
          const openedAt = new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            2,
            11,
          ))
          const closedAt = new Date(Date.now() - (30 * 60 * 1_000))
          const cashSession = await transaction.insertInto("cash_sessions").values({
            tenant_id: tenant.id,
            cash_register_id: register.id,
            opening_operator_id: operator.id,
            opened_at: openedAt,
            opening_amount_cents: 20_000,
            status: "closed",
            closing_operator_id: operator.id,
            closed_at: closedAt,
            closing_note: "Fechamento da carga histórica complementar",
            created_at: openedAt,
            updated_at: closedAt,
          }).returning("id").executeTakeFirstOrThrow()
          await transaction.insertInto("cash_movements").values({
            tenant_id: tenant.id,
            cash_session_id: cashSession.id,
            movement_type: "opening",
            payment_method: "cash",
            amount_cents: 20_000,
            source_type: "cash_session",
            source_id: cashSession.id,
            actor_user_id: operator.id,
            reason: "Abertura da carga histórica complementar",
            occurred_at: openedAt,
            reversal_of_id: null,
          }).execute()

          const purchaseMaximum = await transaction.selectFrom("purchase_orders")
            .select((expression) => expression.fn.max("business_number").as("number"))
            .where("tenant_id", "=", tenant.id)
            .executeTakeFirst()
          const receiptMaximum = await transaction.selectFrom("goods_receipts")
            .select((expression) => expression.fn.max("business_number").as("number"))
            .where("tenant_id", "=", tenant.id)
            .executeTakeFirst()
          let purchaseNumber = Number(purchaseMaximum?.number ?? 0)
          let receiptNumber = Number(receiptMaximum?.number ?? 0)

          for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
            const month = monthStart(monthIndex - 12)
            const orderedAt = new Date(Date.UTC(
              month.getUTCFullYear(), month.getUTCMonth(), 5, 13,
            ))
            const receivedAt = new Date(Date.UTC(
              month.getUTCFullYear(), month.getUTCMonth(), 9 + (monthIndex % 3), 15,
            ))
            purchaseNumber += 1
            receiptNumber += 1
            const purchaseOrder = await transaction.insertInto("purchase_orders").values({
              tenant_id: tenant.id,
              business_number: purchaseNumber,
              supplier_id: supplier.id,
              status: "received",
              ordered_at: orderedAt,
              expected_at: receivedAt,
              created_by: admin.id,
              approved_by: admin.id,
              approved_at: orderedAt,
              cancellation_reason: null,
              recommendation_id: null,
              notes: "Compra da carga histórica complementar",
              created_at: orderedAt,
              updated_at: receivedAt,
            }).returning("id").executeTakeFirstOrThrow()
            const receipt = await transaction.insertInto("goods_receipts").values({
              tenant_id: tenant.id,
              business_number: receiptNumber,
              purchase_order_id: purchaseOrder.id,
              status: "completed",
              supplier_document_reference: `NF-DEMO-${String(receiptNumber).padStart(4, "0")}`,
              received_by: operator.id,
              received_at: receivedAt,
              reversed_by: null,
              reversed_at: null,
              reversal_reason: null,
              created_at: receivedAt,
            }).returning("id").executeTakeFirstOrThrow()

            for (let itemIndex = 0; itemIndex < 2; itemIndex += 1) {
              const product = stockProducts[
                (monthIndex * 2 + itemIndex) % stockProducts.length
              ]
              if (!product) throw new Error("Missing stock product")
              const link = linksByProduct.get(product.id)
              if (!link) throw new Error(`Missing supplier link for ${product.name}`)
              const quantity = 8 + ((monthIndex + itemIndex) % 5) * 2
              const unitCost = product.current_cost_cents ?? 0
              const item = await transaction.insertInto("purchase_order_items").values({
                tenant_id: tenant.id,
                purchase_order_id: purchaseOrder.id,
                product_id: product.id,
                product_name_snapshot: product.name,
                unit_abbreviation_snapshot: product.abbreviation,
                ordered_quantity: quantity,
                received_quantity: quantity,
                agreed_unit_cost_cents: unitCost,
                supplier_sku_snapshot: link.supplier_sku,
                pack_multiple_snapshot: link.pack_multiple,
                minimum_order_quantity_snapshot: link.minimum_order_quantity,
                created_at: orderedAt,
              }).returning("id").executeTakeFirstOrThrow()
              const movement = await transaction.insertInto("stock_movements").values({
                tenant_id: tenant.id,
                product_id: product.id,
                movement_type: "receipt",
                quantity,
                resulting_on_hand: Number(product.on_hand ?? quantity),
                resulting_reserved: Number(product.reserved ?? 0),
                unit_cost_snapshot_cents: unitCost,
                source_type: "goods_receipt",
                source_id: receipt.id,
                source_reference: `NF-DEMO-${String(receiptNumber).padStart(4, "0")}`,
                reason: "Recebimento da carga histórica complementar",
                actor_user_id: operator.id,
                occurred_at: receivedAt,
                reversal_of_id: null,
              }).returning("id").executeTakeFirstOrThrow()
              await transaction.insertInto("goods_receipt_items").values({
                tenant_id: tenant.id,
                goods_receipt_id: receipt.id,
                purchase_order_item_id: item.id,
                product_id: product.id,
                received_quantity: quantity,
                accepted_unit_cost_cents: unitCost,
                lot_reference: `LOTE-${String(month.getUTCFullYear())}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`,
                stock_movement_id: movement.id,
                created_at: receivedAt,
              }).execute()
            }
          }

          const saleMaximum = await transaction.selectFrom("sales")
            .select((expression) => expression.fn.max("business_number").as("number"))
            .where("tenant_id", "=", tenant.id)
            .executeTakeFirst()
          let saleNumber = Number(saleMaximum?.number ?? 0)
          const expected = new Map<PaymentMethod, number>([
            ["cash", 20_000],
            ["credit", 0],
            ["debit", 0],
            ["pix", 0],
          ])
          const availableStock = new Map(
            stockProducts.map((product) => [product.id, Number(product.on_hand ?? 0)]),
          )
          const saleCount = 8
          const elapsedDay = Math.max(2, new Date().getUTCDate() - 1)

          for (let index = 0; index < saleCount; index += 1) {
            const product = saleProducts[index % saleProducts.length]
            const customer = customers[index % 4]
            if (!product || !customer) throw new Error("Missing sale seed relation")
            const completedAt = new Date(Date.UTC(
              new Date().getUTCFullYear(),
              new Date().getUTCMonth(),
              Math.max(2, Math.floor(((index + 1) * elapsedDay) / saleCount)),
              13 + (index % 5),
              10,
            ))
            const quantity = 1
            const gross = product.current_price_cents
            const discount = index % 4 === 3 ? Math.round(gross * 0.05) : 0
            const net = gross - discount
            const paymentMethod = paymentMethods[index % paymentMethods.length] ?? "cash"
            saleNumber += 1
            const sale = await transaction.insertInto("sales").values({
              tenant_id: tenant.id,
              business_number: saleNumber,
              status: "completed",
              customer_id: customer.id,
              customer_name_snapshot: customer.name,
              operator_id: operator.id,
              cash_session_id: cashSession.id,
              gross_amount_cents: gross,
              discount_amount_cents: discount,
              net_amount_cents: net,
              returned_amount_cents: 0,
              change_amount_cents: 0,
              business_date: dateOnly(completedAt),
              completed_at: completedAt,
              cancelled_by: null,
              cancelled_at: null,
              cancellation_reason: null,
              created_at: completedAt,
              updated_at: completedAt,
            }).returning("id").executeTakeFirstOrThrow()
            await transaction.insertInto("sale_items").values({
              tenant_id: tenant.id,
              sale_id: sale.id,
              product_id: product.id,
              product_name_snapshot: product.name,
              product_type_snapshot: product.type,
              unit_abbreviation_snapshot: product.abbreviation,
              quantity,
              unit_price_cents: product.current_price_cents,
              gross_amount_cents: gross,
              allocated_discount_cents: discount,
              net_amount_cents: net,
              unit_cost_snapshot_cents: product.current_cost_cents,
              returned_quantity: 0,
              returned_net_amount_cents: 0,
              service_order_id: null,
              service_order_previous_column_id: null,
              created_at: completedAt,
            }).execute()
            await transaction.insertInto("payments").values({
              tenant_id: tenant.id,
              sale_id: sale.id,
              payment_method: paymentMethod,
              amount_cents: net,
              effective_amount_cents: net,
              installments: paymentMethod === "credit" ? 2 : null,
              status: "completed",
              external_reference: `DEMO-HIST-${String(saleNumber)}`,
              created_at: completedAt,
            }).execute()
            await transaction.insertInto("cash_movements").values({
              tenant_id: tenant.id,
              cash_session_id: cashSession.id,
              movement_type: "sale",
              payment_method: paymentMethod,
              amount_cents: net,
              source_type: "sale",
              source_id: sale.id,
              actor_user_id: operator.id,
              reason: "Venda da carga histórica complementar",
              occurred_at: completedAt,
              reversal_of_id: null,
            }).execute()
            expected.set(paymentMethod, (expected.get(paymentMethod) ?? 0) + net)

            if (product.type !== "service") {
              const oldOnHand = availableStock.get(product.id) ?? 0
              if (oldOnHand < quantity) throw new Error(`Insufficient demo stock for ${product.name}`)
              const newOnHand = oldOnHand - quantity
              await transaction.updateTable("inventory_balances").set({
                on_hand: newOnHand,
                version: sql`version + 1`,
                updated_at: completedAt,
              }).where("tenant_id", "=", tenant.id)
                .where("product_id", "=", product.id)
                .execute()
              await transaction.insertInto("stock_movements").values({
                tenant_id: tenant.id,
                product_id: product.id,
                movement_type: "sale",
                quantity: -quantity,
                resulting_on_hand: newOnHand,
                resulting_reserved: Number(product.reserved ?? 0),
                unit_cost_snapshot_cents: product.current_cost_cents,
                source_type: "sale",
                source_id: sale.id,
                source_reference: String(saleNumber),
                reason: "Venda da carga histórica complementar",
                actor_user_id: operator.id,
                occurred_at: completedAt,
                reversal_of_id: null,
              }).execute()
              availableStock.set(product.id, newOnHand)
            }
          }

          await transaction.insertInto("cash_close_counts").values(
            paymentMethods.map((method) => ({
              tenant_id: tenant.id,
              cash_session_id: cashSession.id,
              payment_method: method,
              expected_amount_cents: expected.get(method) ?? 0,
              counted_amount_cents: expected.get(method) ?? 0,
              difference_cents: 0,
              actor_user_id: operator.id,
              counted_at: closedAt,
            })),
          ).execute()

          const columns = await transaction.selectFrom("service_order_columns")
            .select(["id", "semantic_type", "display_position"])
            .where("tenant_id", "=", tenant.id)
            .where("archived_at", "is", null)
            .orderBy("display_position")
            .execute()
          const completedColumn = columns.find((column) => column.semantic_type === "completed")
          const cancelledColumn = columns.find((column) => column.semantic_type === "cancelled")
          if (!completedColumn || !cancelledColumn) {
            throw new Error("D'lara service-order columns are incomplete")
          }
          const orderMaximum = await transaction.selectFrom("service_orders")
            .select((expression) => expression.fn.max("business_number").as("number"))
            .where("tenant_id", "=", tenant.id)
            .executeTakeFirst()
          let orderNumber = Number(orderMaximum?.number ?? 0)
          let serviceOrderCount = 0

          for (let monthIndex = 0; monthIndex < 11; monthIndex += 1) {
            const month = monthStart(monthIndex - 11)
            for (let sequence = 0; sequence < 2; sequence += 1) {
              const customer = customers[(monthIndex * 2 + sequence) % customers.length]
              if (!customer) throw new Error("Missing service-order customer")
              const createdAt = new Date(Date.UTC(
                month.getUTCFullYear(), month.getUTCMonth(), 8 + sequence * 10, 13,
              ))
              const cancelled = monthIndex % 5 === 0 && sequence === 1
              const completedAt = cancelled
                ? null
                : new Date(createdAt.getTime() + ((2 + (monthIndex % 4)) * 86_400_000))
              const cancelledAt = cancelled
                ? new Date(createdAt.getTime() + 86_400_000)
                : null
              const column = cancelled ? cancelledColumn : completedColumn
              orderNumber += 1
              serviceOrderCount += 1
              const order = await transaction.insertInto("service_orders").values({
                tenant_id: tenant.id,
                business_number: orderNumber,
                customer_id: customer.id,
                customer_name_snapshot: customer.name,
                title: sequence === 0
                  ? "Personalização de enxoval"
                  : "Ajuste e acabamento de peças",
                description: "Ordem da carga histórica complementar da D'lara.",
                priority: sequence === 0 ? "medium" : "high",
                due_at: new Date(createdAt.getTime() + (4 * 86_400_000)),
                estimated_value_cents: 5_500 + (monthIndex * 350) + (sequence * 1_250),
                final_sale_id: null,
                current_column_id: column.id,
                current_status: cancelled ? "cancelled" : "completed",
                responsible_user_id: operator.id,
                completed_at: completedAt,
                cancelled_at: cancelledAt,
                created_by: operator.id,
                updated_by: operator.id,
                created_at: createdAt,
                updated_at: completedAt ?? cancelledAt ?? createdAt,
              }).returning("id").executeTakeFirstOrThrow()
              await transaction.insertInto("service_order_status_history").values({
                tenant_id: tenant.id,
                service_order_id: order.id,
                previous_column_id: null,
                new_column_id: column.id,
                previous_status: null,
                new_status: cancelled ? "cancelled" : "completed",
                actor_user_id: operator.id,
                occurred_at: completedAt ?? cancelledAt ?? createdAt,
                reason: "Carga histórica complementar",
                metadata: { seedVersion: DATA_VERSION },
                created_at: completedAt ?? cancelledAt ?? createdAt,
              }).execute()
            }
          }

          for (const [sequenceName, value] of [
            ["sale", saleNumber],
            ["service_order", orderNumber],
            ["purchase_order", purchaseNumber],
            ["goods_receipt", receiptNumber],
          ] as const) {
            await transaction.insertInto("tenant_sequences").values({
              tenant_id: tenant.id,
              sequence_name: sequenceName,
              current_value: value,
            }).onConflict((conflict) => conflict
              .columns(["tenant_id", "sequence_name"])
              .doUpdateSet({ current_value: value, updated_at: new Date() }))
              .execute()
          }

          await transaction.insertInto("audit_events").values({
            tenant_id: tenant.id,
            actor_type: "system",
            actor_id: null,
            action: "demo.history.data.completed",
            entity_type: "tenant",
            entity_id: tenant.id,
            request_id: null,
            correlation_id: null,
            source: "system",
            reason: DATA_VERSION,
            before_json: null,
            after_json: {
              purchases: 12,
              sales: saleCount,
              serviceOrders: serviceOrderCount,
            },
            ip_address: null,
            user_agent: null,
          }).execute()

          return {
            purchases: 12,
            sales: saleCount,
            serviceOrders: serviceOrderCount,
          }
        })

    const yesterday = new Date()
    yesterday.setUTCHours(0, 0, 0, 0)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const observationStart = new Date(yesterday)
    observationStart.setUTCDate(observationStart.getUTCDate() - 364)
    const stockProducts = await database.selectFrom("products as product")
      .innerJoin("inventory_balances as balance", (join) => join
        .onRef("balance.product_id", "=", "product.id")
        .onRef("balance.tenant_id", "=", "product.tenant_id"))
      .select(["product.id", "balance.on_hand"])
      .where("product.tenant_id", "=", tenant.id)
      .where("product.sku", "like", "DEMO-%")
      .where("product.type", "<>", "service")
      .execute()
    const sales = await sql<{
      product_id: string
      local_date: string
      sold: string
      returned: string
    }>`
      SELECT
        item.product_id,
        sale.business_date::text AS local_date,
        SUM(item.quantity)::text AS sold,
        SUM(item.returned_quantity)::text AS returned
      FROM sale_items AS item
      INNER JOIN sales AS sale
        ON sale.id = item.sale_id
        AND sale.tenant_id = item.tenant_id
      WHERE item.tenant_id = ${tenant.id}::uuid
        AND item.product_id IS NOT NULL
        AND sale.status <> 'cancelled'
        AND sale.business_date >= ${dateOnly(observationStart)}::date
        AND sale.business_date <= ${dateOnly(yesterday)}::date
      GROUP BY item.product_id, sale.business_date
    `.execute(database)
    const receipts = await sql<{
      product_id: string
      local_date: string
      received: string
    }>`
      SELECT
        item.product_id,
        (receipt.received_at AT TIME ZONE 'America/Recife')::date::text AS local_date,
        SUM(item.received_quantity)::text AS received
      FROM goods_receipt_items AS item
      INNER JOIN goods_receipts AS receipt
        ON receipt.id = item.goods_receipt_id
        AND receipt.tenant_id = item.tenant_id
      WHERE item.tenant_id = ${tenant.id}::uuid
        AND receipt.status = 'completed'
        AND (receipt.received_at AT TIME ZONE 'America/Recife')::date
          >= ${dateOnly(observationStart)}::date
        AND (receipt.received_at AT TIME ZONE 'America/Recife')::date
          <= ${dateOnly(yesterday)}::date
      GROUP BY item.product_id, local_date
    `.execute(database)

    for (const product of stockProducts) {
      const productSales = new Map(
        sales.rows.filter((row) => row.product_id === product.id)
          .map((row) => [
            row.local_date,
            { sold: Number(row.sold), returned: Number(row.returned) },
          ]),
      )
      const productReceipts = new Map(
        receipts.rows.filter((row) => row.product_id === product.id)
          .map((row) => [row.local_date, Number(row.received)]),
      )
      const totalNetSold = [...productSales.values()].reduce(
        (total, movement) => total + movement.sold - movement.returned,
        0,
      )
      const totalReceived = [...productReceipts.values()].reduce(
        (total, received) => total + received,
        0,
      )
      let opening = Number(product.on_hand) + totalNetSold - totalReceived
      await database.deleteFrom("inventory_daily_snapshots")
        .where("tenant_id", "=", tenant.id)
        .where("product_id", "=", product.id)
        .where("local_date", ">=", dateOnly(observationStart))
        .where("local_date", "<=", dateOnly(yesterday))
        .execute()

      for (
        let date = new Date(observationStart);
        date <= yesterday;
        date.setUTCDate(date.getUTCDate() + 1)
      ) {
        const localDate = dateOnly(date)
        const sale = productSales.get(localDate) ?? { sold: 0, returned: 0 }
        const received = productReceipts.get(localDate) ?? 0
        const closing = Math.max(0, opening + received - sale.sold + sale.returned)
        await database.insertInto("inventory_daily_snapshots").values({
          tenant_id: tenant.id,
          product_id: product.id,
          local_date: localDate,
          opening: Math.max(0, opening),
          received,
          sold: sale.sold,
          returned: sale.returned,
          adjusted: 0,
          closing,
          reserved: 0,
          in_stock_minutes: closing > 0 ? 1_440 : 1_080,
          stockout_minutes: closing > 0 ? 0 : 360,
          observed_minutes: 1_440,
          last_observed_at: new Date(date.getTime() + 86_400_000),
          complete: true,
        }).execute()
        opening = closing
      }
    }

    const admin = await database.selectFrom("users").select("id")
      .where("tenant_id", "=", tenant.id)
      .where("role", "=", "admin")
      .where("status", "=", "active")
      .where("archived_at", "is", null)
      .orderBy("created_at")
      .executeTakeFirstOrThrow()
    const forecasts = await generateForecasts(database, {
      tenantId: tenant.id,
      actorId: admin.id,
      includeRevenue: true,
    })
    const recommendations = await generateRecommendations(database, {
      tenantId: tenant.id,
      actorId: admin.id,
    })
    await database.insertInto("audit_events").values({
      tenant_id: tenant.id,
      actor_type: "system",
      actor_id: null,
      action: "demo.history.completed",
      entity_type: "tenant",
      entity_id: tenant.id,
      request_id: null,
      correlation_id: null,
      source: "system",
      reason: FINAL_VERSION,
      before_json: null,
      after_json: {
        ...inserted,
        forecastRuns: forecasts.count,
        publishedForecasts: forecasts.publishedCount,
        recommendations: recommendations.count,
      },
      ip_address: null,
      user_agent: null,
    }).execute()
    console.info(
      `D'lara complementary history created: ${String(inserted.purchases)} purchases, `
      + `${String(inserted.sales)} sales and ${String(inserted.serviceOrders)} service orders.`,
    )
  }
} finally {
  await database.destroy()
}
