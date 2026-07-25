import type { FastifyInstance } from "fastify"
import { KyselyInventoryRepository } from "./inventory-repository.js"
import { inventoryRoutes } from "./routes.js"
import { InventoryService } from "./inventory-service.js"
import { KyselyStockCountRepository } from "./stock-count-repository.js"
import { stockCountRoutes } from "./stock-count-routes.js"
import { StockCountService } from "./stock-count-service.js"

export function registerInventoryModule(app: FastifyInstance): void {
  const repository = new KyselyInventoryRepository(app.db)
  const service = new InventoryService(repository)
  const stockCountRepository = new KyselyStockCountRepository(app.db)
  const stockCountService = new StockCountService(stockCountRepository)

  app.decorate("inventoryService", service)
  app.decorate("stockCountService", stockCountService)
  void app.register(inventoryRoutes, { prefix: "/api/v1" })
  void app.register(stockCountRoutes, { prefix: "/api/v1" })
}
