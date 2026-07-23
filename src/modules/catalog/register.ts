import type { FastifyInstance } from "fastify"
import { KyselyCatalogRepository } from "./catalog-repository.js"
import { CatalogService } from "./catalog-service.js"
import { catalogRoutes } from "./routes.js"

export function registerCatalogModule(app: FastifyInstance): void {
  const repository = new KyselyCatalogRepository(app.db)
  const service = new CatalogService(repository)

  app.decorate("catalogService", service)
  void app.register(catalogRoutes, { prefix: "/api/v1" })
}
