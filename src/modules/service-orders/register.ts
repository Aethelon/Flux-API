import type { FastifyInstance } from "fastify"
import { serviceOrderRoutes } from "./routes.js"
import { KyselyServiceOrderRepository } from "./service-order-repository.js"
import { ServiceOrderService } from "./service-order-service.js"

export function registerServiceOrderModule(app: FastifyInstance): void {
  const service = new ServiceOrderService(new KyselyServiceOrderRepository(app.db))
  app.decorate("serviceOrderService", service)
  void app.register(serviceOrderRoutes, { prefix: "/api/v1" })
}
