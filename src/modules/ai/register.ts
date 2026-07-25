import type { FastifyInstance } from "fastify"
import { KyselyAiRepository } from "./ai-repository.js"
import { AiService } from "./ai-service.js"
import { aiRoutes } from "./routes.js"

export function registerAiModule(app: FastifyInstance): void {
  const service = new AiService(
    app.db,
    new KyselyAiRepository(app.db),
    app.config,
  )
  app.decorate("aiService", service)
  void app.register(aiRoutes, { prefix: "/api/v1" })
}
