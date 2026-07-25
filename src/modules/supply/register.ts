import type { FastifyInstance } from "fastify"
import { supplyRoutes } from "./routes.js"
import { SupplyService } from "./supply-service.js"
import { KyselySupplyRepository } from "./supply-repository.js"

export function registerSupplyModule(app: FastifyInstance): void {
  const service = new SupplyService(new KyselySupplyRepository(app.db))
  app.decorate("supplyService", service)
  void app.register(supplyRoutes, { prefix: "/api/v1" })
}
