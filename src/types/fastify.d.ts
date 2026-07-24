import type { Kysely } from "kysely"
import type { AppConfig } from "../config/env.js"
import type { AuthService } from "../modules/auth/auth-service.js"
import type { AuthenticatedUser } from "../modules/auth/types.js"
import type { Database, UserRole } from "../database/types.js"
import type { CatalogService } from "../modules/catalog/catalog-service.js"
import type { InventoryService } from "../modules/inventory/inventory-service.js"

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig
    db: Kysely<Database>
    authService: AuthService
    catalogService: CatalogService
    inventoryService: InventoryService
    authenticate: (request: FastifyRequest) => Promise<void>
    authorize: (roles: readonly UserRole[]) => (request: FastifyRequest) => Promise<void>
  }

  interface FastifyRequest {
    auth: AuthenticatedUser | null
  }
}
