import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_PHASE_ONE_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl

interface JsonResponse {
  statusCode: number
  body: Record<string, unknown>
}

void describe("Phase 1 PostgreSQL integration", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let adminToken: string
  let employeeToken: string
  let operatorJobRoleId: string

  async function request(
    method: "GET" | "POST" | "PATCH",
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
      slug: `phase-one-${randomUUID()}`,
      name: "Phase One Validation",
      status: "active",
      archived_at: null,
    }).returning(["id", "slug"]).executeTakeFirstOrThrow()
    await app.db.insertInto("tenant_settings").values({
      tenant_id: tenant.id,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    operatorJobRoleId = (await app.db.selectFrom("job_roles").select("id")
      .where("tenant_id", "=", tenant.id).where("system_key", "=", "operator")
      .executeTakeFirstOrThrow()).id
    const admin = await app.db.insertInto("users").values({
      tenant_id: tenant.id,
      name: "Integration Admin",
      email: `admin-${randomUUID()}@phase-one.test`,
      phone: null,
      password_hash: await hashPassword("integration-admin-password"),
      role: "admin",
      status: "active",
      archived_at: null,
    }).returning(["id", "email"]).executeTakeFirstOrThrow()
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: admin.email,
        password: "integration-admin-password",
        tenantSlug: tenant.slug,
      },
    })
    assert.equal(login.statusCode, 200)
    adminToken = login.json<{ accessToken: string }>().accessToken
  })

  after(async () => {
    await app.close()
  })

  void it("executes the complete operational flow with permissions and reversals", async () => {
    const employeePassword = "test1234"
    const employee = await request("POST", "/api/v1/employees", adminToken, {
      name: "Integration Employee",
      email: `employee-${randomUUID()}@phase-one.test`,
      jobRoleId: operatorJobRoleId,
      password: employeePassword,
    }, randomUUID())
    assert.equal(employee.statusCode, 201)
    const employeeLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: employee.body.email,
        password: employeePassword,
      },
    })
    assert.equal(employeeLogin.statusCode, 200)
    employeeToken = employeeLogin.json<{ accessToken: string }>().accessToken

    assert.equal((await request("GET", "/api/v1/employees", employeeToken)).statusCode, 403)
    assert.equal((await request("GET", "/api/v1/cash-sessions", employeeToken)).statusCode, 403)
    for (const route of [
      "/api/v1/suppliers",
      "/api/v1/purchase-orders",
      "/api/v1/goods-receipts",
    ]) {
      assert.equal((await request("GET", route, adminToken)).statusCode, 404)
    }

    const missingRegister = await request("GET", "/api/v1/cash-registers/me", employeeToken)
    assert.equal(missingRegister.statusCode, 404)
    const opened = await request(
      "POST",
      "/api/v1/cash-registers/me/open",
      employeeToken,
      { openingAmountCents: 1_000 },
      randomUUID(),
    )
    assert.equal(opened.statusCode, 201)
    const ownRegister = await request("GET", "/api/v1/cash-registers/me", employeeToken)
    assert.equal(ownRegister.statusCode, 200)
    const ownSession = ownRegister.body.session as { id: string }
    assert.equal(ownSession.id, opened.body.id)

    const customerKey = randomUUID()
    const customerPayload = {
      name: "Integration Customer",
      email: "customer@phase-one.test",
      phone: `819${String(Math.floor(Math.random() * 1_000_000)).padStart(7, "0")}`,
    }
    const customer = await request(
      "POST", "/api/v1/customers", employeeToken, customerPayload, customerKey,
    )
    const replayedCustomer = await request(
      "POST", "/api/v1/customers", employeeToken, customerPayload, customerKey,
    )
    assert.equal(customer.statusCode, 201)
    assert.equal(replayedCustomer.body.id, customer.body.id)
    const duplicateCustomer = await request(
      "POST",
      "/api/v1/customers",
      employeeToken,
      { name: "Duplicate Phone", phone: customerPayload.phone },
      randomUUID(),
    )
    assert.equal(duplicateCustomer.statusCode, 409)
    assert.equal(duplicateCustomer.body.code, "DUPLICATE_CUSTOMER_PHONE")
    const customerWithoutPhone = await request(
      "POST",
      "/api/v1/customers",
      employeeToken,
      { name: "Missing Phone" },
      randomUUID(),
    )
    assert.equal(customerWithoutPhone.statusCode, 400)

    const categoryKey = randomUUID()
    const categoryPayload = {
      name: `Integration ${randomUUID()}`,
    }
    const category = await request(
      "POST", "/api/v1/categories", adminToken, categoryPayload, categoryKey,
    )
    const replayedCategory = await request(
      "POST", "/api/v1/categories", adminToken, categoryPayload, categoryKey,
    )
    const unit = await request("POST", "/api/v1/units", adminToken, {
      name: `Unit ${randomUUID()}`,
      abbreviation: `u${randomUUID().slice(0, 6)}`,
      allowsFractional: false,
      quantityScale: 0,
    }, randomUUID())
    assert.equal(category.statusCode, 201)
    assert.equal(replayedCategory.body.id, category.body.id)
    assert.equal(unit.statusCode, 201)
    const product = await request("POST", "/api/v1/products", adminToken, {
      type: "finished_product",
      name: "Integration Product",
      priceCents: 1_000,
      costCents: 500,
      costSource: "manual",
      categoryId: category.body.id,
      unitId: unit.body.id,
      minimumStock: 2,
    }, randomUUID())
    assert.equal(product.statusCode, 201)

    const inventoryEntry = await request("POST", "/api/v1/inventory/movements", adminToken, {
      productId: product.body.id,
      type: "receipt",
      quantity: 10,
      unitCostCents: 500,
      sourceReference: "INTEGRATION-ENTRY",
      reason: "Integration inventory entry",
    }, randomUUID())
    assert.equal(inventoryEntry.statusCode, 201)

    const serviceOrder = await request("POST", "/api/v1/service-orders", employeeToken, {
      customerId: customer.body.id,
      title: "Integration Service",
      description: "Service billed directly at the point of sale.",
      priority: "medium",
      estimatedValueCents: 2_500,
    }, randomUUID())
    assert.equal(serviceOrder.statusCode, 201)
    const serviceOrderColumns = await request(
      "GET", "/api/v1/service-order-columns", employeeToken,
    )
    const columns = serviceOrderColumns.body as unknown as Array<{
      id: string
      semanticType: "open" | "completed" | "cancelled"
      readyForSale: boolean
    }>
    const openColumn = columns.find((column) => column.semanticType === "open" && !column.readyForSale)
    const readyColumn = columns.find((column) => column.readyForSale)
    const completedColumn = columns.find((column) => column.semanticType === "completed")
    const cancelledColumn = columns.find((column) => column.semanticType === "cancelled")
    assert.ok(openColumn)
    assert.ok(readyColumn)
    assert.ok(completedColumn)
    assert.ok(cancelledColumn)

    const lifecycleOrder = await request("POST", "/api/v1/service-orders", employeeToken, {
      customerId: customer.body.id,
      title: "Movable terminal service",
      priority: "medium",
      estimatedValueCents: 1_500,
    }, randomUUID())
    const cancelledOrder = await request(
      "POST",
      `/api/v1/service-orders/${String(lifecycleOrder.body.id)}/transitions`,
      employeeToken,
      {
        version: lifecycleOrder.body.version,
        columnId: cancelledColumn.id,
        reason: "Exercise cancelled order movement.",
      },
      randomUUID(),
    )
    assert.equal(cancelledOrder.statusCode, 200)
    assert.equal(cancelledOrder.body.status, "cancelled")
    const directDelivery = await request(
      "POST",
      `/api/v1/service-orders/${String(lifecycleOrder.body.id)}/transitions`,
      employeeToken,
      {
        version: cancelledOrder.body.version,
        columnId: completedColumn.id,
        reason: "Attempt delivery without completing a sale.",
      },
      randomUUID(),
    )
    assert.equal(directDelivery.statusCode, 409)
    assert.equal(directDelivery.body.code, "DELIVERY_REQUIRES_SALE")
    const reopenedCancelledOrder = await request(
      "POST",
      `/api/v1/service-orders/${String(lifecycleOrder.body.id)}/transitions`,
      employeeToken,
      {
        version: cancelledOrder.body.version,
        columnId: openColumn.id,
        reason: "Reopen a cancelled order.",
      },
      randomUUID(),
    )
    assert.equal(reopenedCancelledOrder.statusCode, 200)
    assert.equal(reopenedCancelledOrder.body.status, "open")
    const editedOpenOrder = await request(
      "PATCH",
      `/api/v1/service-orders/${String(lifecycleOrder.body.id)}`,
      employeeToken,
      { version: reopenedCancelledOrder.body.version, title: "Edited open service" },
      randomUUID(),
    )
    assert.equal(editedOpenOrder.statusCode, 200)

    const readyOrder = await request(
      "POST",
      `/api/v1/service-orders/${String(serviceOrder.body.id)}/transitions`,
      employeeToken,
      {
        version: serviceOrder.body.version,
        columnId: readyColumn.id,
        reason: "Service is ready for pickup and payment.",
      },
      randomUUID(),
    )
    assert.equal(readyOrder.statusCode, 200)
    assert.equal(readyOrder.body.status, "open")
    assert.equal((readyOrder.body.column as { readyForSale: boolean }).readyForSale, true)

    const serviceSale = await request("POST", "/api/v1/sales", employeeToken, {
      customerId: customer.body.id,
      items: [{ serviceOrderId: serviceOrder.body.id }],
      payments: [{ method: "cash", amountCents: 2_500 }],
    }, randomUUID())
    assert.equal(serviceSale.statusCode, 201)
    const billedOrder = await request(
      "GET", `/api/v1/service-orders/${String(serviceOrder.body.id)}`, employeeToken,
    )
    assert.equal(billedOrder.body.status, "completed")
    const billedColumn = billedOrder.body.column as {
      semanticType: "open" | "completed" | "cancelled"
      readyForSale: boolean
    }
    assert.equal(billedColumn.semanticType, "completed")
    assert.equal(billedColumn.readyForSale, false)
    assert.equal(billedOrder.body.finalSaleId, serviceSale.body.id)
    const soldTransition = await request(
      "POST",
      `/api/v1/service-orders/${String(serviceOrder.body.id)}/transitions`,
      employeeToken,
      {
        version: billedOrder.body.version,
        columnId: (serviceOrder.body.column as { id: string }).id,
        reason: "Attempt to reopen a sold order.",
      },
      randomUUID(),
    )
    assert.equal(soldTransition.statusCode, 409)
    assert.equal(soldTransition.body.code, "SERVICE_ORDER_ALREADY_BILLED")
    assert.equal(soldTransition.body.message, "Esta ordem já foi vendida e não pode ser alterada.")
    const soldUpdate = await request(
      "PATCH",
      `/api/v1/service-orders/${String(serviceOrder.body.id)}`,
      employeeToken,
      { version: billedOrder.body.version, title: "Changed sold order" },
      randomUUID(),
    )
    assert.equal(soldUpdate.statusCode, 409)
    assert.equal(soldUpdate.body.code, "SERVICE_ORDER_ALREADY_BILLED")
    const cancelledServiceSale = await request(
      "POST",
      `/api/v1/sales/${String(serviceSale.body.id)}/cancel`,
      employeeToken,
      { version: serviceSale.body.version, reason: "Integration cancellation" },
      randomUUID(),
    )
    assert.equal(cancelledServiceSale.statusCode, 200)
    const reopenedOrder = await request(
      "GET", `/api/v1/service-orders/${String(serviceOrder.body.id)}`, employeeToken,
    )
    assert.equal(reopenedOrder.body.status, "open")
    assert.equal((reopenedOrder.body.column as { readyForSale: boolean }).readyForSale, true)
    assert.equal(reopenedOrder.body.finalSaleId, null)

    const productSale = await request("POST", "/api/v1/sales", employeeToken, {
      customerId: customer.body.id,
      items: [{ productId: product.body.id, quantity: 2 }],
      payments: [{ method: "cash", amountCents: 2_000 }],
    }, randomUUID())
    assert.equal(productSale.statusCode, 201)
    const soldItem = (productSale.body.items as Array<Record<string, unknown>>)[0]
    assert.ok(soldItem)
    const saleReturn = await request(
      "POST",
      `/api/v1/sales/${String(productSale.body.id)}/returns`,
      employeeToken,
      {
        reason: "Integration product return",
        items: [{ saleItemId: soldItem.id, quantity: 1, restock: true }],
        refunds: [{ method: "cash", amountCents: 1_000 }],
      },
      randomUUID(),
    )
    assert.equal(saleReturn.statusCode, 201)
    assert.equal(saleReturn.body.totalAmountCents, 1_000)

    assert.equal((await request(
      "POST",
      "/api/v1/cash-registers/me/supplies",
      employeeToken,
      { amountCents: 100, reason: "Integration supply" },
      randomUUID(),
    )).statusCode, 200)
    assert.equal((await request(
      "POST",
      "/api/v1/cash-registers/me/withdrawals",
      employeeToken,
      { amountCents: 50, reason: "Integration withdrawal" },
      randomUUID(),
    )).statusCode, 200)
    const current = await request("GET", "/api/v1/cash-registers/me", employeeToken)
    const currentSession = current.body.session as Record<string, unknown>
    const closed = await request(
      "POST",
      "/api/v1/cash-registers/me/close",
      employeeToken,
      {
        version: currentSession.version,
        countedByMethod: { cash: 2_050, credit: 0, debit: 0, pix: 0 },
        note: "Integration close",
      },
      randomUUID(),
    )
    assert.equal(closed.statusCode, 200)
    assert.equal(closed.body.status, "closed")

    const relevantAudit = await app.db.selectFrom("audit_events")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("action", "in", [
        "inventory.movement_posted",
        "sale.completed",
        "sale.cancelled",
        "sale.returned",
        "cash_session.closed",
      ]).executeTakeFirstOrThrow()
    assert.ok(Number(relevantAudit.count) >= 5)
  })
})
