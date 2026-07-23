import "dotenv/config"
import envSchema from "env-schema"

const configSchema = {
  type: "object",
  required: [
    "NODE_ENV",
    "HOST",
    "PORT",
    "LOG_LEVEL",
    "CORS_ORIGINS",
    "DATABASE_URL",
    "DATABASE_POOL_MAX",
    "JWT_ACCESS_SECRET",
    "JWT_ACCESS_TTL_SECONDS",
    "REFRESH_TOKEN_TTL_DAYS",
  ],
  properties: {
    NODE_ENV: { type: "string", enum: ["development", "test", "production"] },
    HOST: { type: "string", minLength: 1 },
    PORT: { type: "integer", minimum: 1, maximum: 65_535 },
    LOG_LEVEL: {
      type: "string",
      enum: ["fatal", "error", "warn", "info", "debug", "trace", "silent"],
    },
    CORS_ORIGINS: { type: "string", minLength: 1 },
    DATABASE_URL: { type: "string", minLength: 1 },
    DATABASE_POOL_MAX: { type: "integer", minimum: 1, maximum: 100 },
    JWT_ACCESS_SECRET: { type: "string", minLength: 32 },
    JWT_ACCESS_TTL_SECONDS: { type: "integer", minimum: 60, maximum: 86_400 },
    REFRESH_TOKEN_TTL_DAYS: { type: "integer", minimum: 1, maximum: 365 },
  },
} as const

interface RawConfig {
  NODE_ENV: "development" | "test" | "production"
  HOST: string
  PORT: number
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent"
  CORS_ORIGINS: string
  DATABASE_URL: string
  DATABASE_POOL_MAX: number
  JWT_ACCESS_SECRET: string
  JWT_ACCESS_TTL_SECONDS: number
  REFRESH_TOKEN_TTL_DAYS: number
}

export interface AppConfig {
  nodeEnv: RawConfig["NODE_ENV"]
  host: string
  port: number
  logLevel: RawConfig["LOG_LEVEL"]
  corsOrigins: string[]
  databaseUrl: string
  databasePoolMax: number
  jwtAccessSecret: string
  jwtAccessTtlSeconds: number
  refreshTokenTtlDays: number
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = envSchema<RawConfig>({
    schema: configSchema,
    data: environment,
    dotenv: false,
  })

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    corsOrigins: raw.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
    databaseUrl: raw.DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX,
    jwtAccessSecret: raw.JWT_ACCESS_SECRET,
    jwtAccessTtlSeconds: raw.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
  }
}
