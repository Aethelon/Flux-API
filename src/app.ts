import Fastify, { type FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import swagger from "@fastify/swagger"
import swaggerUi from "@fastify/swagger-ui"
import {
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox"
import type { Kysely } from "kysely"
import { loadConfig, type AppConfig } from "./config/env.js"
import { createDatabase } from "./database/client.js"
import type { Database } from "./database/types.js"
import { registerErrorHandler } from "./shared/errors/error-handler.js"
import { healthRoutes } from "./modules/health/routes.js"
import { registerAuthModule } from "./modules/auth/register.js"
import { registerCatalogModule } from "./modules/catalog/register.js"
import { registerInventoryModule } from "./modules/inventory/register.js"
import { registerPeopleModule } from "./modules/people/register.js"
import { registerSupplyModule } from "./modules/supply/register.js"
import { registerCashModule } from "./modules/cash/register.js"
import { registerSalesModule } from "./modules/sales/register.js"
import { registerServiceOrderModule } from "./modules/service-orders/register.js"
import { registerHistoryModule } from "./modules/history/register.js"
import { registerDashboardModule } from "./modules/dashboard/register.js"
import { registerAuditModule } from "./modules/audit/register.js"
import { registerExportModule } from "./modules/exports/register.js"

interface BuildAppOptions {
  config?: AppConfig
  database?: Kysely<Database>
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig()
  const database = options.database ?? createDatabase(config)
  const app = Fastify({
    logger: (options.logger ?? config.nodeEnv !== "test")
      ? {
          level: config.logLevel,
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "body.password",
              "body.refreshToken",
            ],
            censor: "[REDACTED]",
          },
        }
      : false,
    requestIdHeader: "x-request-id",
    trustProxy: config.nodeEnv === "production",
  }).withTypeProvider<TypeBoxTypeProvider>()

  app.setValidatorCompiler(TypeBoxValidatorCompiler)
  app.decorate("config", config)
  app.decorate("db", database)
  app.addHook("onClose", async () => {
    await database.destroy()
  })

  void app.register(helmet)
  void app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  })
  void app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  })
  void app.register(swagger, {
    openapi: {
      info: {
        title: "Flux API",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  })
  void app.register(swaggerUi, {
    routePrefix: "/documentation",
  })

  registerErrorHandler(app)
  registerAuthModule(app)
  registerCatalogModule(app)
  registerInventoryModule(app)
  registerPeopleModule(app)
  registerSupplyModule(app)
  registerCashModule(app)
  registerSalesModule(app)
  registerServiceOrderModule(app)
  registerHistoryModule(app)
  registerDashboardModule(app)
  registerAuditModule(app)
  registerExportModule(app)
  void app.register(healthRoutes, { prefix: "/api/v1/health" })

  return app
}
