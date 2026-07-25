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
  JWT_ACCESS_SECRET: string
  JWT_ACCESS_TTL_SECONDS: number
  REFRESH_TOKEN_TTL_DAYS: number
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
  jwtAccessSecret: string
  jwtAccessTtlSeconds: number
  refreshTokenTtlDays: number
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
