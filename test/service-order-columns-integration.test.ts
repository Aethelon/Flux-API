import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { hashPassword } from "../src/modules/auth/password.js"
import { testConfig } from "./helpers/config.js"

const runIntegration = process.env.RUN_SERVICE_ORDER_COLUMNS_INTEGRATION === "1"
const integrationDatabaseUrl = process.env.DATABASE_URL ?? testConfig.databaseUrl

interface Column {
  id: string
  label: string
  semanticType: "open" | "completed" | "cancelled"
  displayPosition: number
  protected: boolean
  version: number
}

void describe("Service-order column ordering", { skip: !runIntegration }, () => {
  let app: FastifyInstance
  let adminToken: string

  before(async () => {
    app = buildApp({
      config: { ...testConfig, databaseUrl: integrationDatabaseUrl },
      logger: false,
    })
    await app.ready()
    const tenant = await app.db.insertInto("tenants").values({
      slug: `column-order-${randomUUID()}`,
      name: "Column ordering test",
      status: "active",
      archived_at: null,
    }).returning("id").executeTakeFirstOrThrow()
    await app.db.insertInto("tenant_settings").values({
      tenant_id: tenant.id,
      timezone: "America/Recife",
      currency: "BRL",
    }).execute()
    const email = `admin-${randomUUID()}@column-order.test`
    await app.db.insertInto("users").values({
      tenant_id: tenant.id,
      name: "Column Ordering Admin",
      email,
      phone: null,
      password_hash: await hashPassword("column-order-password"),
      role: "admin",
      status: "active",
      archived_at: null,
    }).execute()
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "column-order-password" },
    })
    assert.equal(login.statusCode, 200)
    adminToken = login.json<{ accessToken: string }>().accessToken
  })

  after(async () => app.close())

  void it("moves a column across an occupied position atomically", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/service-order-columns",
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(list.statusCode, 200)
    const columns = list.json<Column[]>()
    const waiting = columns.find((column) => column.label === "Aguardando Peças")
    const inProgress = columns.find((column) => column.label === "Em Andamento")
    assert.ok(waiting)
    assert.ok(inProgress)

    const reordered = [...columns]
    reordered.splice(reordered.indexOf(waiting), 1)
    reordered.splice(reordered.indexOf(inProgress), 0, waiting)

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/service-order-columns/reorder",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        columns: reordered.map((column) => ({ id: column.id, version: column.version })),
      },
    })

    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      response.json<Column[]>().map((column) => column.id),
      reordered.map((column) => column.id),
    )
    assert.deepEqual(
      response.json<Column[]>().map((column) => column.displayPosition),
      reordered.map((_column, index) => index),
    )
  })

  void it("protects completed and cancelled system columns from removal", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/service-order-columns",
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(list.statusCode, 200)
    const columns = list.json<Column[]>()
    const completed = columns.find((column) => column.semanticType === "completed")
    const cancelled = columns.find((column) => column.semanticType === "cancelled")
    assert.ok(completed)
    assert.ok(cancelled)
    assert.equal(completed.protected, true)
    assert.equal(cancelled.protected, true)

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/service-order-columns/${cancelled.id}/archive`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        version: cancelled.version,
        reason: "System column removal must be rejected.",
      },
    })

    assert.equal(response.statusCode, 409, response.body)
    assert.equal(response.json<{ code: string }>().code, "PROTECTED_COLUMN")
  })
})
