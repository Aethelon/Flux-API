import type { FastifyInstance } from "fastify"
import { salesRoutes } from "./routes.js"
import { KyselySalesRepository } from "./sales-repository.js"
import { SalesService } from "./sales-service.js"

export function registerSalesModule(app: FastifyInstance): void {
  const service = new SalesService(new KyselySalesRepository(app.db))
  app.decorate("salesService", service)
  void app.register(salesRoutes, { prefix: "/api/v1" })
}
