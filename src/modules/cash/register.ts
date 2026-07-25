import type { FastifyInstance } from "fastify"
import { KyselyCashRepository } from "./cash-repository.js"
import { cashRoutes } from "./routes.js"
import { CashService } from "./cash-service.js"

export function registerCashModule(app: FastifyInstance): void {
  const service = new CashService(new KyselyCashRepository(app.db))
  app.decorate("cashService", service)
  void app.register(cashRoutes, { prefix: "/api/v1" })
}
