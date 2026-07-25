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
    const employeePassword = "integration-employee-password"
    const employee = await request("POST", "/api/v1/employees", adminToken, {
      name: "Integration Employee",
      email: `employee-${randomUUID()}@phase-one.test`,
      role: "funcionario",
      password: employeePassword,
    }, randomUUID())
    assert.equal(employee.statusCode, 201)
    const employeeId = String(employee.body.id)
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
    assert.equal((await request("GET", "/api/v1/suppliers", employeeToken)).statusCode, 403)

    const register = await request("POST", "/api/v1/cash-registers", adminToken, {
      code: `register-${randomUUID().slice(0, 8)}`,
      name: "Integration Register",
    }, randomUUID())
    assert.equal(register.statusCode, 201)
    const assignment = await request(
      "POST",
      "/api/v1/cash-register-assignments",
      adminToken,
      {
        userId: employeeId,
        registerId: register.body.id,
        reason: "Integration assignment",
      },
      randomUUID(),
    )
    assert.equal(assignment.statusCode, 201)
    const ownRegister = await request("GET", "/api/v1/cash-registers/me", employeeToken)
    assert.equal(ownRegister.statusCode, 200)
    assert.equal(ownRegister.body.session, null)
    const opened = await request(
      "POST",
      "/api/v1/cash-registers/me/open",
      employeeToken,
      { openingAmountCents: 1_000 },
      randomUUID(),
    )
    assert.equal(opened.statusCode, 201)

    const customerKey = randomUUID()
    const customerPayload = {
      name: "Integration Customer",
      email: "customer@phase-one.test",
    }
    const customer = await request(
      "POST", "/api/v1/customers", employeeToken, customerPayload, customerKey,
    )
    const replayedCustomer = await request(
      "POST", "/api/v1/customers", employeeToken, customerPayload, customerKey,
    )
    assert.equal(customer.statusCode, 201)
    assert.equal(replayedCustomer.body.id, customer.body.id)

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

    const supplier = await request("POST", "/api/v1/suppliers", adminToken, {
      legalName: "Integration Supplier",
      taxId: "12345678901",
    }, randomUUID())
    assert.equal(supplier.statusCode, 201)
    const relation = await request(
      "POST",
      `/api/v1/suppliers/${String(supplier.body.id)}/products`,
      adminToken,
      {
        productId: product.body.id,
        leadTimeDays: 2,
        minimumOrderQuantity: 1,
        packMultiple: 1,
      },
      randomUUID(),
    )
    assert.equal(relation.statusCode, 201)
    const purchase = await request("POST", "/api/v1/purchase-orders", adminToken, {
      supplierId: supplier.body.id,
      items: [{
        productId: product.body.id,
        quantity: 10,
        agreedUnitCostCents: 500,
      }],
    }, randomUUID())
    assert.equal(purchase.statusCode, 201)
    const submitted = await request(
      "POST",
      `/api/v1/purchase-orders/${String(purchase.body.id)}/submit`,
      adminToken,
      { version: purchase.body.version },
      randomUUID(),
    )
    assert.equal(submitted.statusCode, 200)
    const purchaseItem = (submitted.body.items as Array<Record<string, unknown>>)[0]
    assert.ok(purchaseItem)
    const receiptPayload = {
      purchaseOrderId: purchase.body.id,
      supplierDocumentReference: "NF-INTEGRATION",
      items: [{
        purchaseOrderItemId: purchaseItem.id,
        quantity: 10,
        acceptedUnitCostCents: 500,
      }],
    }
    const firstReceipt = await request(
      "POST", "/api/v1/goods-receipts", adminToken, receiptPayload, randomUUID(),
    )
    assert.equal(firstReceipt.statusCode, 201)
    const reversedReceipt = await request(
      "POST",
      `/api/v1/goods-receipts/${String(firstReceipt.body.id)}/reverse`,
      adminToken,
      { reason: "Integration receipt reversal" },
      randomUUID(),
    )
    assert.equal(reversedReceipt.statusCode, 200)
    assert.equal(reversedReceipt.body.status, "reversed")
    const secondReceipt = await request(
      "POST", "/api/v1/goods-receipts", adminToken, receiptPayload, randomUUID(),
    )
    assert.equal(secondReceipt.statusCode, 201)

    const serviceOrder = await request("POST", "/api/v1/service-orders", employeeToken, {
      customerId: customer.body.id,
      title: "Integration Service",
      description: "Service billed directly at the point of sale.",
      priority: "medium",
      estimatedValueCents: 2_500,
    }, randomUUID())
    assert.equal(serviceOrder.statusCode, 201)
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
    assert.equal(billedOrder.body.finalSaleId, serviceSale.body.id)
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
        "goods_receipt.reversed",
        "sale.completed",
        "sale.cancelled",
        "sale.returned",
        "cash_session.closed",
      ]).executeTakeFirstOrThrow()
    assert.ok(Number(relevantAudit.count) >= 5)
  })
})
