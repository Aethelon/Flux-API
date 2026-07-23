import type { AppConfig } from "../../src/config/env.js"

export const testConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3333,
  logLevel: "silent",
  corsOrigins: ["http://localhost:3000"],
  databaseUrl: "postgres://flux:flux@127.0.0.1:1/flux",
  databasePoolMax: 1,
  jwtAccessSecret: "test-secret-with-at-least-thirty-two-characters",
  jwtAccessTtlSeconds: 900,
  refreshTokenTtlDays: 30,
}
