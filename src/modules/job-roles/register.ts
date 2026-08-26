import type { FastifyInstance } from "fastify"
import { JobRoleRepository } from "./job-role-repository.js"
import { JobRoleService } from "./job-role-service.js"
import { jobRoleRoutes } from "./routes.js"

export function registerJobRoleModule(app: FastifyInstance): void {
  app.decorate("jobRoleService", new JobRoleService(new JobRoleRepository(app.db)))
  void app.register(jobRoleRoutes, { prefix: "/api/v1" })
}
