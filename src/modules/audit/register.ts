import type { FastifyInstance } from "fastify"
import { KyselyAuditRepository } from "./audit-repository.js"
import { AuditService } from "./audit-service.js"
import { auditRoutes } from "./routes.js"

export function registerAuditModule(app: FastifyInstance): void {
  const service = new AuditService(new KyselyAuditRepository(app.db))
  app.decorate("auditService", service)
  void app.register(auditRoutes, { prefix: "/api/v1" })
}
