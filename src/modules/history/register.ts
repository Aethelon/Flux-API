import type { FastifyInstance } from "fastify"
import { KyselyHistoryRepository } from "./history-repository.js"
import { HistoryService } from "./history-service.js"
import { historyRoutes } from "./routes.js"

export function registerHistoryModule(app: FastifyInstance): void {
  const service = new HistoryService(new KyselyHistoryRepository(app.db))
  app.decorate("historyService", service)
  void app.register(historyRoutes, { prefix: "/api/v1" })
}
