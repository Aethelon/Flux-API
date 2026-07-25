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
    DATABASE_CONNECTION_TIMEOUT_MS: {
      type: "integer", minimum: 100, maximum: 60_000, default: 5_000,
    },
    DATABASE_STATEMENT_TIMEOUT_MS: {
      type: "integer", minimum: 1_000, maximum: 300_000, default: 15_000,
    },
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: {
      type: "integer", minimum: 1_000, maximum: 300_000, default: 15_000,
    },
    JWT_ACCESS_SECRET: { type: "string", minLength: 32 },
    JWT_ACCESS_TTL_SECONDS: { type: "integer", minimum: 60, maximum: 86_400 },
    REFRESH_TOKEN_TTL_DAYS: { type: "integer", minimum: 1, maximum: 365 },
    HTTP_BODY_LIMIT_BYTES: {
      type: "integer", minimum: 16_384, maximum: 10_485_760, default: 1_048_576,
    },
    HTTP_REQUEST_TIMEOUT_MS: {
      type: "integer", minimum: 1_000, maximum: 120_000, default: 30_000,
    },
    MONITORING_TOKEN: { type: "string", default: "" },
    MONITORING_JOB_STALE_MINUTES: {
      type: "integer", minimum: 1, maximum: 1_440, default: 15,
    },
    MONITORING_OUTBOX_STALE_MINUTES: {
      type: "integer", minimum: 1, maximum: 1_440, default: 5,
    },
    MONITORING_FORECAST_STALE_HOURS: {
      type: "integer", minimum: 1, maximum: 720, default: 48,
    },
    MONITORING_BACKUP_STALE_HOURS: {
      type: "integer", minimum: 1, maximum: 720, default: 24,
    },
    MONITORING_AI_COST_ALERT_MICRO_USD: {
      type: "integer", minimum: 0, maximum: 1_000_000_000, default: 100_000,
    },
    LOG_RETENTION_DAYS: {
      type: "integer", minimum: 1, maximum: 365, default: 30,
    },
    OUTBOX_RETENTION_DAYS: {
      type: "integer", minimum: 1, maximum: 3_650, default: 30,
    },
    AUTH_SESSION_RETENTION_DAYS: {
      type: "integer", minimum: 1, maximum: 3_650, default: 90,
    },
    BACKUP_RPO_HOURS: {
      type: "integer", minimum: 1, maximum: 168, default: 24,
    },
    BACKUP_RTO_MINUTES: {
      type: "integer", minimum: 1, maximum: 10_080, default: 60,
    },
    AI_PROVIDER: {
      type: "string",
      enum: ["disabled", "gemini", "anthropic"],
      default: "disabled",
    },
    GEMINI_API_KEY: { type: "string", default: "" },
    GEMINI_MODEL_ID: { type: "string", default: "gemini-3.5-flash-lite" },
    ANTHROPIC_API_KEY: { type: "string", default: "" },
    ANTHROPIC_MODEL_ID: {
      type: "string",
      default: "claude-haiku-4-5-20251001",
    },
    AI_TIMEOUT_MS: { type: "integer", minimum: 1_000, maximum: 120_000, default: 20_000 },
    AI_MAX_OUTPUT_TOKENS: { type: "integer", minimum: 100, maximum: 8_192, default: 1_500 },
    AI_MAX_RETRIES: { type: "integer", minimum: 0, maximum: 5, default: 2 },
    AI_CACHE_TTL_HOURS: { type: "integer", minimum: 1, maximum: 720, default: 24 },
    AI_TEMPERATURE: { type: "number", minimum: 0, maximum: 0.2, default: 0.1 },
    AI_PROMPT_VERSION: { type: "string", default: "insights-prompt-v1" },
    AI_SCHEMA_VERSION: { type: "string", default: "insights-schema-v1" },
    AI_POLICY_VERSION: { type: "string", default: "insights-policy-v1" },
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
  DATABASE_CONNECTION_TIMEOUT_MS: number
  DATABASE_STATEMENT_TIMEOUT_MS: number
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: number
  JWT_ACCESS_SECRET: string
  JWT_ACCESS_TTL_SECONDS: number
  REFRESH_TOKEN_TTL_DAYS: number
  HTTP_BODY_LIMIT_BYTES: number
  HTTP_REQUEST_TIMEOUT_MS: number
  MONITORING_TOKEN: string
  MONITORING_JOB_STALE_MINUTES: number
  MONITORING_OUTBOX_STALE_MINUTES: number
  MONITORING_FORECAST_STALE_HOURS: number
  MONITORING_BACKUP_STALE_HOURS: number
  MONITORING_AI_COST_ALERT_MICRO_USD: number
  LOG_RETENTION_DAYS: number
  OUTBOX_RETENTION_DAYS: number
  AUTH_SESSION_RETENTION_DAYS: number
  BACKUP_RPO_HOURS: number
  BACKUP_RTO_MINUTES: number
  AI_PROVIDER: "disabled" | "gemini" | "anthropic"
  GEMINI_API_KEY: string
  GEMINI_MODEL_ID: string
  ANTHROPIC_API_KEY: string
  ANTHROPIC_MODEL_ID: string
  AI_TIMEOUT_MS: number
  AI_MAX_OUTPUT_TOKENS: number
  AI_MAX_RETRIES: number
  AI_CACHE_TTL_HOURS: number
  AI_TEMPERATURE: number
  AI_PROMPT_VERSION: string
  AI_SCHEMA_VERSION: string
  AI_POLICY_VERSION: string
}

export interface AppConfig {
  nodeEnv: RawConfig["NODE_ENV"]
  host: string
  port: number
  logLevel: RawConfig["LOG_LEVEL"]
  corsOrigins: string[]
  databaseUrl: string
  databasePoolMax: number
  databaseConnectionTimeoutMs: number
  databaseStatementTimeoutMs: number
  databaseIdleTransactionTimeoutMs: number
  jwtAccessSecret: string
  jwtAccessTtlSeconds: number
  refreshTokenTtlDays: number
  httpBodyLimitBytes: number
  httpRequestTimeoutMs: number
  monitoringToken: string | null
  monitoringJobStaleMinutes: number
  monitoringOutboxStaleMinutes: number
  monitoringForecastStaleHours: number
  monitoringBackupStaleHours: number
  monitoringAiCostAlertMicroUsd: number
  logRetentionDays: number
  outboxRetentionDays: number
  authSessionRetentionDays: number
  backupRpoHours: number
  backupRtoMinutes: number
  aiProvider: RawConfig["AI_PROVIDER"]
  geminiApiKey: string | null
  geminiModelId: string
  anthropicApiKey: string | null
  anthropicModelId: string
  aiTimeoutMs: number
  aiMaxOutputTokens: number
  aiMaxRetries: number
  aiCacheTtlHours: number
  aiTemperature: number
  aiPromptVersion: string
  aiSchemaVersion: string
  aiPolicyVersion: string
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = envSchema<RawConfig>({
    schema: configSchema,
    data: environment,
    dotenv: false,
  })

  const corsOrigins = raw.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  if (raw.NODE_ENV === "production" && corsOrigins.includes("*")) {
    throw new Error("Wildcard CORS origins are not allowed in production.")
  }
  if (
    raw.NODE_ENV === "production"
    && raw.MONITORING_TOKEN.length < 32
  ) {
    throw new Error("MONITORING_TOKEN must contain at least 32 characters in production.")
  }

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    corsOrigins,
    databaseUrl: raw.DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX,
    databaseConnectionTimeoutMs: raw.DATABASE_CONNECTION_TIMEOUT_MS,
    databaseStatementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
    databaseIdleTransactionTimeoutMs: raw.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    jwtAccessSecret: raw.JWT_ACCESS_SECRET,
    jwtAccessTtlSeconds: raw.JWT_ACCESS_TTL_SECONDS,
    refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
    httpBodyLimitBytes: raw.HTTP_BODY_LIMIT_BYTES,
    httpRequestTimeoutMs: raw.HTTP_REQUEST_TIMEOUT_MS,
    monitoringToken: raw.MONITORING_TOKEN || null,
    monitoringJobStaleMinutes: raw.MONITORING_JOB_STALE_MINUTES,
    monitoringOutboxStaleMinutes: raw.MONITORING_OUTBOX_STALE_MINUTES,
    monitoringForecastStaleHours: raw.MONITORING_FORECAST_STALE_HOURS,
    monitoringBackupStaleHours: raw.MONITORING_BACKUP_STALE_HOURS,
    monitoringAiCostAlertMicroUsd: raw.MONITORING_AI_COST_ALERT_MICRO_USD,
    logRetentionDays: raw.LOG_RETENTION_DAYS,
    outboxRetentionDays: raw.OUTBOX_RETENTION_DAYS,
    authSessionRetentionDays: raw.AUTH_SESSION_RETENTION_DAYS,
    backupRpoHours: raw.BACKUP_RPO_HOURS,
    backupRtoMinutes: raw.BACKUP_RTO_MINUTES,
    aiProvider: raw.AI_PROVIDER,
    geminiApiKey: raw.GEMINI_API_KEY || null,
    geminiModelId: raw.GEMINI_MODEL_ID,
    anthropicApiKey: raw.ANTHROPIC_API_KEY || null,
    anthropicModelId: raw.ANTHROPIC_MODEL_ID,
    aiTimeoutMs: raw.AI_TIMEOUT_MS,
    aiMaxOutputTokens: raw.AI_MAX_OUTPUT_TOKENS,
    aiMaxRetries: raw.AI_MAX_RETRIES,
    aiCacheTtlHours: raw.AI_CACHE_TTL_HOURS,
    aiTemperature: raw.AI_TEMPERATURE,
    aiPromptVersion: raw.AI_PROMPT_VERSION,
    aiSchemaVersion: raw.AI_SCHEMA_VERSION,
    aiPolicyVersion: raw.AI_POLICY_VERSION,
  }
}
