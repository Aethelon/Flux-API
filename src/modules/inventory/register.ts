import type { FastifyInstance } from "fastify"
import { KyselyInventoryRepository } from "./inventory-repository.js"
import { inventoryRoutes } from "./routes.js"
import { InventoryService } from "./inventory-service.js"

export function registerInventoryModule(app: FastifyInstance): void {
  const repository = new KyselyInventoryRepository(app.db)
  const service = new InventoryService(repository)

  app.decorate("inventoryService", service)
  void app.register(inventoryRoutes, { prefix: "/api/v1" })
}
