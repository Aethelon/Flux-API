import type { FastifyInstance } from "fastify"
import { KyselyExportRepository } from "./export-repository.js"
import { ExportService } from "./export-service.js"
import { exportRoutes } from "./routes.js"

export function registerExportModule(app: FastifyInstance): void {
  const service = new ExportService(new KyselyExportRepository(app.db))
  app.decorate("exportService", service)
  void app.register(exportRoutes, { prefix: "/api/v1" })
}
