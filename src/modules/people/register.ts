import type { FastifyInstance } from "fastify"
import { KyselyPeopleRepository } from "./people-repository.js"
import { peopleRoutes } from "./routes.js"
import { PeopleService } from "./people-service.js"

export function registerPeopleModule(app: FastifyInstance): void {
  const service = new PeopleService(new KyselyPeopleRepository(app.db))
  app.decorate("peopleService", service)
  void app.register(peopleRoutes, { prefix: "/api/v1" })
}
