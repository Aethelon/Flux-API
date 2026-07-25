import type { FastifyInstance } from "fastify"
import { MonitoringService } from "./monitoring-service.js"
import { monitoringRoutes } from "./routes.js"

export function registerMonitoringModule(app: FastifyInstance): void {
  app.decorate("monitoringService", new MonitoringService(app.db, app.config))
  void app.register(monitoringRoutes, { prefix: "/api/v1/monitoring" })
}
