import type { FastifyInstance } from "fastify"
import { KyselyHistoryRepository } from "../history/history-repository.js"
import { KyselyDashboardRepository } from "./dashboard-repository.js"
import { DashboardService } from "./dashboard-service.js"
import { dashboardRoutes } from "./routes.js"

export function registerDashboardModule(app: FastifyInstance): void {
  const historyRepository = new KyselyHistoryRepository(app.db)
  const service = new DashboardService(
    new KyselyDashboardRepository(app.db, historyRepository),
  )
  app.decorate("dashboardService", service)
  void app.register(dashboardRoutes, { prefix: "/api/v1" })
}
