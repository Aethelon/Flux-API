import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import type { FastifyInstance } from "fastify"
import { buildApp } from "../src/app.js"
import { testConfig } from "./helpers/config.js"

void describe("HTTP foundation", () => {
  let app: FastifyInstance

  before(async () => {
    app = buildApp({
      config: testConfig,
      logger: false,
    })
    await app.ready()
  })

  after(async () => {
    await app.close()
  })

  void it("returns liveness without requiring a database connection", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health/live",
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.json<{ status: string }>().status, "ok")
  })

  void it("rejects an invalid login body before database access", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "invalid",
        password: "short",
      },
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json<{ code: string }>().code, "VALIDATION_ERROR")
  })

  void it("protects authenticated routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
    })

    assert.equal(response.statusCode, 401)
    assert.equal(response.json<{ code: string }>().code, "UNAUTHORIZED")
  })

  void it("returns the stable error shape for an unknown route", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/unknown",
    })

    assert.equal(response.statusCode, 404)
    assert.deepEqual(
      Object.keys(response.json<Record<string, unknown>>()).sort(),
      ["code", "message", "requestId"],
    )
  })
})
