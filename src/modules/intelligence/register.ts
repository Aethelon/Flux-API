import type { FastifyInstance } from "fastify"
import { KyselyIntelligenceRepository } from "./intelligence-repository.js"
import { IntelligenceService } from "./intelligence-service.js"
import { intelligenceRoutes } from "./routes.js"

export function registerIntelligenceModule(app: FastifyInstance): void {
  const service = new IntelligenceService(new KyselyIntelligenceRepository(app.db))
  app.decorate("intelligenceService", service)
  void app.register(intelligenceRoutes, { prefix: "/api/v1" })
}
