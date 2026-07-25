import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { processPendingExports } from "../src/modules/exports/export-job.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_PHASE_TWO_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl
const from = "2026-07-25T00:00:00.000Z"
const to = "2026-07-26T00:00:00.000Z"

interface JsonResponse {
  statusCode: number
  body: Record<string, unknown>
}

void describe("Phase 2 PostgreSQL integration", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let adminToken: string
  let employeeToken: string
  let tenantId: string
  let adminId: string
  let employeeId: string

  async function request(
    method: "GET" | "POST",
    url: string,
    token: string,
    payload?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<JsonResponse> {
    const response = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    })
    return {
      statusCode: response.statusCode,
      body: response.json<Record<string, unknown>>(),
    }
  }

  before(async () => {
    app = buildApp({
      config: {
        ...testConfig,
        databaseUrl: integrationDatabaseUrl,
        databasePoolMax: 4,
      },
      logger: false,
    })
    await app.ready()
    const tenant = await app.db.insertInto("tenants").values({
      slug: `phase-two-${randomUUID()}`,
      name: "Phase Two Validation",
      status: "active",
      archived_at: null,
    }).returning(["id", "slug"]).executeTakeFirstOrThrow()
    tenantId = tenant.id
    await app.db.insertInto("tenant_settings").values({
      tenant_id: tenantId,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    const passwordHash = await hashPassword("phase-two-password")
    const admin = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Two Admin",
      email: `admin-${randomUUID()}@phase-two.test`,
      phone: null,
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    adminId = admin.id
    const employee = await app.db.insertInto("users").values({
      tenant_id: tenantId,
      name: "Phase Two Employee",
      email: `employee-${randomUUID()}@phase-two.test`,
      phone: null,
      password_hash: passwordHash,
      role: "funcionario",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    employeeId = employee.id

    for (const loginInput of [
      { email: admin.email, assign: (token: string) => { adminToken = token } },
      { email: employee.email, assign: (token: string) => { employeeToken = token } },
    ]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: loginInput.email,
          password: "phase-two-password",
        },
      })
      assert.equal(login.statusCode, 200)
      loginInput.assign(login.json<{ accessToken: string }>().accessToken)
    }

    const category = await app.db.insertInto("categories").values({
      tenant_id: tenantId,
      parent_id: null,
      name: "Phase Two Category",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const unit = await app.db.insertInto("units").values({
      tenant_id: tenantId,
      name: "Unidade",
      abbreviation: `un-${randomUUID().slice(0, 6)}`,
      allows_fractional: false,
      quantity_scale: 0,
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const product = await app.db.insertInto("products").values({
      tenant_id: tenantId,
      category_id: category.id,
      unit_id: unit.id,
      sku: null,
      barcode: null,
      type: "finished_product",
      name: "Phase Two Product",
      description: "",
      active: true,
      minimum_stock: 2,
      current_price_cents: 1_000,
      current_cost_cents: 500,
      cost_source: "moving_average",
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("inventory_balances").values({
      tenant_id: tenantId,
      product_id: product.id,
      on_hand: 5,
      reserved: 0,
      average_unit_cost_cents: 500,
    }).execute()
    const customer = await app.db.insertInto("customers").values({
      tenant_id: tenantId,
      name: "Phase Two Customer",
      email: null,
      phone: null,
      notes: "",
      status: "active",
      consent_at: null,
      anonymized_at: null,
      created_by: employeeId,
      updated_by: employeeId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const register = await app.db.insertInto("cash_registers").values({
      tenant_id: tenantId,
      code: `phase-two-${randomUUID().slice(0, 6)}`,
      name: "Phase Two Register",
      active: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    const cashSession = await app.db.insertInto("cash_sessions").values({
      tenant_id: tenantId,
      cash_register_id: register.id,
      opening_operator_id: employeeId,
      opened_at: new Date("2026-07-25T09:00:00.000Z"),
      opening_amount_cents: 1_000,
      status: "closed",
      closing_operator_id: employeeId,
      closed_at: new Date("2026-07-25T18:00:00.000Z"),
      closing_note: "Phase Two close",
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("cash_close_counts").values([
      {
        tenant_id: tenantId,
        cash_session_id: cashSession.id,
        payment_method: "cash",
        expected_amount_cents: 2_800,
        counted_amount_cents: 2_750,
        difference_cents: -50,
        actor_user_id: employeeId,
      },
      {
        tenant_id: tenantId,
        cash_session_id: cashSession.id,
        payment_method: "credit",
        expected_amount_cents: 0,
        counted_amount_cents: 0,
        difference_cents: 0,
        actor_user_id: employeeId,
      },
      {
        tenant_id: tenantId,
        cash_session_id: cashSession.id,
        payment_method: "debit",
        expected_amount_cents: 0,
        counted_amount_cents: 0,
        difference_cents: 0,
        actor_user_id: employeeId,
      },
      {
        tenant_id: tenantId,
        cash_session_id: cashSession.id,
        payment_method: "pix",
        expected_amount_cents: 1_000,
        counted_amount_cents: 1_000,
        difference_cents: 0,
        actor_user_id: employeeId,
      },
    ]).execute()

    const returnedSale = await app.db.insertInto("sales").values({
      tenant_id: tenantId,
      business_number: 1,
      status: "partially_returned",
      customer_id: customer.id,
      customer_name_snapshot: "Phase Two Customer",
      operator_id: employeeId,
      cash_session_id: cashSession.id,
      gross_amount_cents: 3_000,
      discount_amount_cents: 300,
      net_amount_cents: 2_700,
      returned_amount_cents: 900,
      change_amount_cents: 0,
      business_date: "2026-07-25",
      completed_at: new Date("2026-07-25T14:00:00.000Z"),
      cancelled_by: null,
      cancelled_at: null,
      cancellation_reason: null,
    }).returning("id").executeTakeFirstOrThrow()
    const returnedItem = await app.db.insertInto("sale_items").values({
      tenant_id: tenantId,
      sale_id: returnedSale.id,
      product_id: product.id,
      product_name_snapshot: "Phase Two Product",
      product_type_snapshot: "finished_product",
      unit_abbreviation_snapshot: "un",
      quantity: 3,
      unit_price_cents: 1_000,
      gross_amount_cents: 3_000,
      allocated_discount_cents: 300,
      net_amount_cents: 2_700,
      unit_cost_snapshot_cents: 500,
      returned_quantity: 1,
      returned_net_amount_cents: 900,
      service_order_id: null,
      service_order_previous_column_id: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("payments").values({
      tenant_id: tenantId,
      sale_id: returnedSale.id,
      payment_method: "cash",
      amount_cents: 2_700,
      effective_amount_cents: 2_700,
      installments: null,
      status: "partially_refunded",
      external_reference: null,
    }).execute()
    const saleReturn = await app.db.insertInto("sale_returns").values({
      tenant_id: tenantId,
      business_number: 1,
      sale_id: returnedSale.id,
      operator_id: employeeId,
      cash_session_id: cashSession.id,
      reason: "Phase Two return",
      total_amount_cents: 900,
      status: "completed",
      completed_at: new Date("2026-07-26T16:00:00.000Z"),
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("sale_return_items").values({
      tenant_id: tenantId,
      return_id: saleReturn.id,
      sale_item_id: returnedItem.id,
      quantity: 1,
      amount_cents: 900,
      restock: false,
      unit_cost_snapshot_cents: 500,
      stock_movement_id: null,
    }).execute()
    await app.db.insertInto("sale_return_refunds").values({
      tenant_id: tenantId,
      return_id: saleReturn.id,
      payment_method: "cash",
      amount_cents: 900,
      external_reference: null,
    }).execute()

    const incompleteCostSale = await app.db.insertInto("sales").values({
      tenant_id: tenantId,
      business_number: 2,
      status: "completed",
      customer_id: null,
      customer_name_snapshot: null,
      operator_id: employeeId,
      cash_session_id: cashSession.id,
      gross_amount_cents: 1_000,
      discount_amount_cents: 0,
      net_amount_cents: 1_000,
      returned_amount_cents: 0,
      change_amount_cents: 0,
      business_date: "2026-07-25",
      completed_at: new Date("2026-07-25T15:00:00.000Z"),
      cancelled_by: null,
      cancelled_at: null,
      cancellation_reason: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("sale_items").values({
      tenant_id: tenantId,
      sale_id: incompleteCostSale.id,
      product_id: product.id,
      product_name_snapshot: "Phase Two Product",
      product_type_snapshot: "finished_product",
      unit_abbreviation_snapshot: "un",
      quantity: 1,
      unit_price_cents: 1_000,
      gross_amount_cents: 1_000,
      allocated_discount_cents: 0,
      net_amount_cents: 1_000,
      unit_cost_snapshot_cents: null,
      returned_quantity: 0,
      returned_net_amount_cents: 0,
      service_order_id: null,
      service_order_previous_column_id: null,
    }).execute()
    await app.db.insertInto("payments").values({
      tenant_id: tenantId,
      sale_id: incompleteCostSale.id,
      payment_method: "pix",
      amount_cents: 1_000,
      effective_amount_cents: 1_000,
      installments: null,
      status: "completed",
      external_reference: null,
    }).execute()

    const cancelledSale = await app.db.insertInto("sales").values({
      tenant_id: tenantId,
      business_number: 3,
      status: "cancelled",
      customer_id: null,
      customer_name_snapshot: null,
      operator_id: employeeId,
      cash_session_id: cashSession.id,
      gross_amount_cents: 1_000,
      discount_amount_cents: 0,
      net_amount_cents: 1_000,
      returned_amount_cents: 0,
      change_amount_cents: 0,
      business_date: "2026-07-25",
      completed_at: new Date("2026-07-25T17:00:00.000Z"),
      cancelled_by: employeeId,
      cancelled_at: new Date("2026-07-25T17:30:00.000Z"),
      cancellation_reason: "Phase Two cancellation",
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("sale_items").values({
      tenant_id: tenantId,
      sale_id: cancelledSale.id,
      product_id: product.id,
      product_name_snapshot: "Phase Two Product",
      product_type_snapshot: "finished_product",
      unit_abbreviation_snapshot: "un",
      quantity: 1,
      unit_price_cents: 1_000,
      gross_amount_cents: 1_000,
      allocated_discount_cents: 0,
      net_amount_cents: 1_000,
      unit_cost_snapshot_cents: 500,
      returned_quantity: 0,
      returned_net_amount_cents: 0,
      service_order_id: null,
      service_order_previous_column_id: null,
    }).execute()
    await app.db.insertInto("payments").values({
      tenant_id: tenantId,
      sale_id: cancelledSale.id,
      payment_method: "cash",
      amount_cents: 1_000,
      effective_amount_cents: 1_000,
      installments: null,
      status: "reversed",
      external_reference: null,
    }).execute()

    const completedColumn = await app.db.insertInto("service_order_columns").values({
      tenant_id: tenantId,
      label: "Concluído",
      semantic_type: "completed",
      color_token: "--color-success",
      display_position: 0,
      protected: true,
      created_by: adminId,
      updated_by: adminId,
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("service_orders").values({
      tenant_id: tenantId,
      business_number: 1,
      customer_id: customer.id,
      customer_name_snapshot: "Phase Two Customer",
      title: "Completed service",
      description: "",
      priority: "medium",
      due_at: new Date("2026-07-25T14:00:00.000Z"),
      estimated_value_cents: 500,
      final_sale_id: null,
      current_column_id: completedColumn.id,
      current_status: "completed",
      responsible_user_id: employeeId,
      completed_at: new Date("2026-07-25T13:00:00.000Z"),
      cancelled_at: null,
      created_by: employeeId,
      updated_by: employeeId,
      created_at: new Date("2026-07-25T10:00:00.000Z"),
    }).execute()
    await app.db.updateTable("products").set({
      name: "Renamed Phase Two Product",
      current_price_cents: 9_999,
      updated_by: adminId,
      updated_at: new Date("2026-07-25T20:00:00.000Z"),
    }).where("tenant_id", "=", tenantId).where("id", "=", product.id).execute()
    await app.db.insertInto("audit_events").values({
      tenant_id: tenantId,
      occurred_at: new Date("2026-07-25T19:00:00.000Z"),
      actor_type: "user",
      actor_id: adminId,
      action: "phase_two.sensitive_test",
      entity_type: "user",
      entity_id: employeeId,
      request_id: "phase-two-request",
      correlation_id: null,
      source: "api",
      reason: "Phase Two audit",
      before_json: { passwordHash: "must-not-leak" },
      after_json: { status: "active" },
      ip_address: null,
      user_agent: null,
    }).execute()

    const otherTenant = await app.db.insertInto("tenants").values({
      slug: `phase-two-other-${randomUUID()}`,
      name: "Other Tenant",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("tenant_settings").values({
      tenant_id: otherTenant.id,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    await app.db.insertInto("audit_events").values({
      tenant_id: otherTenant.id,
      actor_type: "system",
      actor_id: null,
      action: "other_tenant.event",
      entity_type: "tenant",
      entity_id: otherTenant.id,
      request_id: null,
      correlation_id: null,
      source: "system",
      reason: null,
      before_json: null,
      after_json: null,
      ip_address: null,
      user_agent: null,
    }).execute()
  })

  after(async () => {
    await app.close()
  })

  void it("enforces history, KPI, dashboard, audit, and export permissions", async () => {
    assert.equal((await request(
      "GET", `/api/v1/history/kpis?from=${from}&to=${to}`, employeeToken,
    )).statusCode, 403)
    assert.equal((await request(
      "GET", `/api/v1/dashboard?from=${from}&to=${to}`, employeeToken,
    )).statusCode, 403)
    assert.equal((await request("GET", "/api/v1/audit-events", employeeToken)).statusCode, 403)
    assert.equal((await request(
      "POST",
      "/api/v1/exports",
      employeeToken,
      { source: "sales_kpis", from, to },
      randomUUID(),
    )).statusCode, 403)

    const employeeHistory = await request(
      "GET",
      `/api/v1/history/sales?from=${from}&to=${to}&limit=2`,
      employeeToken,
    )
    assert.equal(employeeHistory.statusCode, 200, JSON.stringify(employeeHistory.body))
    const employeeRows = employeeHistory.body.data as Array<Record<string, unknown>>
    assert.equal(employeeRows.length, 2)
    assert.equal("financial" in (employeeRows[0] ?? {}), false)
    assert.equal(typeof employeeHistory.body.nextCursor, "string")

    const secondPage = await request(
      "GET",
      `/api/v1/history/sales?from=${from}&to=${to}&limit=2&cursor=${
        encodeURIComponent(String(employeeHistory.body.nextCursor))
      }`,
      employeeToken,
    )
    assert.equal(secondPage.statusCode, 200)
    assert.equal((secondPage.body.data as unknown[]).length, 1)

    const adminHistory = await request(
      "GET", `/api/v1/history/sales?from=${from}&to=${to}`, adminToken,
    )
    assert.equal(adminHistory.statusCode, 200)
    const adminRows = adminHistory.body.data as Array<Record<string, unknown>>
    assert.equal(adminRows.length, 3)
    assert.equal("financial" in (adminRows[0] ?? {}), true)
    assert.equal(
      adminRows.every((row) =>
        (row.itemNames as string[]).every((name) => name === "Phase Two Product")
      ),
      true,
    )

    const kpis = await request(
      "GET", `/api/v1/history/kpis?from=${from}&to=${to}`, adminToken,
    )
    assert.equal(kpis.statusCode, 200)
    assert.equal(kpis.body.grossRevenueCents, 4_000)
    assert.equal(kpis.body.discountAmountCents, 300)
    assert.equal(kpis.body.returnedAmountCents, 0)
    assert.equal(kpis.body.netRevenueCents, 3_700)
    assert.equal(kpis.body.completedSaleCount, 2)
    assert.equal(kpis.body.averageTicketCents, 1_850)
    assert.equal(kpis.body.unitsSold, 4)
    assert.equal(kpis.body.cogsCents, null)
    assert.deepEqual(kpis.body.completeness, {
      transactionsComplete: true,
      costsComplete: false,
      costCoverageRate: 0.5,
    })

    const returnPeriodKpis = await request(
      "GET",
      "/api/v1/history/kpis"
        + "?from=2026-07-26T00:00:00.000Z"
        + "&to=2026-07-27T00:00:00.000Z",
      adminToken,
    )
    assert.equal(
      returnPeriodKpis.statusCode,
      200,
      JSON.stringify(returnPeriodKpis.body),
    )
    assert.equal(returnPeriodKpis.body.grossRevenueCents, 0)
    assert.equal(returnPeriodKpis.body.returnedAmountCents, 900)
    assert.equal(returnPeriodKpis.body.netRevenueCents, -900)
    assert.equal(returnPeriodKpis.body.unitsSold, -1)
    assert.equal(returnPeriodKpis.body.cogsCents, -500)

    const dashboard = await request(
      "GET",
      `/api/v1/dashboard?from=${from}&to=${to}&bucket=day&topBy=units`,
      adminToken,
    )
    assert.equal(dashboard.statusCode, 200)
    const inventory = dashboard.body.inventory as Record<string, unknown>
    assert.equal(inventory.inventoryValueCents, 2_500)
    const cash = dashboard.body.cash as Record<string, unknown>
    assert.equal(cash.closingDifferenceCents, -50)
    const serviceOrders = dashboard.body.serviceOrders as Record<string, unknown>
    assert.equal(serviceOrders.completedCount, 1)
    assert.equal(serviceOrders.averageCycleTimeHours, 3)

    const audit = await request(
      "GET", "/api/v1/audit-events?action=phase_two.sensitive_test", adminToken,
    )
    assert.equal(audit.statusCode, 200)
    const auditRows = audit.body.data as Array<Record<string, unknown>>
    assert.equal(auditRows.length, 1)
    assert.deepEqual(auditRows[0]?.before, { passwordHash: "[REDACTED]" })
    assert.equal(JSON.stringify(audit.body).includes("other_tenant.event"), false)

    const employeeExport = await request(
      "POST",
      "/api/v1/exports",
      employeeToken,
      { source: "sales_history", from, to },
      randomUUID(),
    )
    assert.equal(employeeExport.statusCode, 202)
    assert.equal(await processPendingExports(app.db), 1)
    const exportId = String(employeeExport.body.id)
    const exportStatus = await request(
      "GET", `/api/v1/exports/${exportId}`, employeeToken,
    )
    assert.equal(exportStatus.body.status, "completed")
    assert.equal(exportStatus.body.downloadReady, true)
    const download = await app.inject({
      method: "GET",
      url: `/api/v1/exports/${exportId}/download`,
      headers: { authorization: `Bearer ${employeeToken}` },
    })
    assert.equal(download.statusCode, 200)
    assert.match(download.body, /business_number/)
    assert.equal(download.body.includes("gross_amount_cents"), false)

    const adminExport = await request(
      "POST",
      "/api/v1/exports",
      adminToken,
      { source: "sales_kpis", from, to },
      randomUUID(),
    )
    assert.equal(adminExport.statusCode, 202)
    assert.equal(await processPendingExports(app.db), 1)
    const adminDownload = await app.inject({
      method: "GET",
      url: `/api/v1/exports/${String(adminExport.body.id)}/download`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(adminDownload.statusCode, 200)
    assert.match(adminDownload.body, /gross_revenue_cents/)
    assert.match(adminDownload.body, /4000/)

    const staleJob = await app.db.insertInto("job_runs").values({
      tenant_id: tenantId,
      job_type: "export",
      status: "processing",
      requested_by: employeeId,
      parameters: { source: "sales_history", from, to },
      cursor: null,
      total_count: null,
      processed_count: 0,
      attempts: 1,
      error_class: null,
      error_message: null,
      available_at: new Date("2026-07-25T00:00:00.000Z"),
      started_at: new Date("2026-07-25T00:00:00.000Z"),
      finished_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    assert.equal(await processPendingExports(app.db), 1)
    const recovered = await app.db.selectFrom("job_runs").select("status")
      .where("id", "=", staleJob.id).executeTakeFirstOrThrow()
    assert.equal(recovered.status, "completed")
  })
})
