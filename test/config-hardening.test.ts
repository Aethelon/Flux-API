import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { loadConfig } from "../src/config/env.js"

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3333",
  LOG_LEVEL: "info",
  CORS_ORIGINS: "https://flux.example.com",
  DATABASE_URL: "postgres://flux:secret@database:5432/flux",
  DATABASE_POOL_MAX: "10",
  JWT_ACCESS_SECRET: "production-secret-with-at-least-thirty-two-characters",
  JWT_ACCESS_TTL_SECONDS: "900",
  REFRESH_TOKEN_TTL_DAYS: "30",
  MONITORING_TOKEN: "production-monitoring-token-at-least-32-characters",
}

void describe("production configuration hardening", () => {
  void it("rejects wildcard CORS origins", () => {
    assert.throws(
      () => loadConfig({
        ...productionEnvironment,
        CORS_ORIGINS: "*",
      }),
      /Wildcard CORS origins are not allowed/,
    )
  })

  void it("rejects a missing or weak monitoring token", () => {
    assert.throws(
      () => loadConfig({
        ...productionEnvironment,
        MONITORING_TOKEN: "short",
      }),
      /MONITORING_TOKEN must contain at least 32 characters/,
    )
  })

  void it("loads bounded operational defaults", () => {
    const config = loadConfig(productionEnvironment)

    assert.equal(config.httpBodyLimitBytes, 1_048_576)
    assert.equal(config.httpRequestTimeoutMs, 30_000)
    assert.equal(config.databaseStatementTimeoutMs, 15_000)
    assert.equal(config.monitoringBackupStaleHours, 24)
    assert.equal(config.backupRpoHours, 24)
    assert.equal(config.backupRtoMinutes, 60)
  })
})
