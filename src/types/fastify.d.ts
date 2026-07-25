import type { Kysely } from "kysely"
import type { AppConfig } from "../config/env.js"
import type { AuthService } from "../modules/auth/auth-service.js"
import type { AuthenticatedUser } from "../modules/auth/types.js"
import type { Database, UserRole } from "../database/types.js"
import type { CatalogService } from "../modules/catalog/catalog-service.js"
import type { InventoryService } from "../modules/inventory/inventory-service.js"
import type { StockCountService } from "../modules/inventory/stock-count-service.js"
import type { PeopleService } from "../modules/people/people-service.js"
import type { SupplyService } from "../modules/supply/supply-service.js"
import type { CashService } from "../modules/cash/cash-service.js"
import type { SalesService } from "../modules/sales/sales-service.js"
import type { ServiceOrderService } from "../modules/service-orders/service-order-service.js"
import type { HistoryService } from "../modules/history/history-service.js"
import type { DashboardService } from "../modules/dashboard/dashboard-service.js"
import type { AuditService } from "../modules/audit/audit-service.js"
import type { ExportService } from "../modules/exports/export-service.js"
import type { IntelligenceService } from "../modules/intelligence/intelligence-service.js"
import type { AiService } from "../modules/ai/ai-service.js"

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig
    db: Kysely<Database>
    authService: AuthService
    catalogService: CatalogService
    inventoryService: InventoryService
    stockCountService: StockCountService
    peopleService: PeopleService
    supplyService: SupplyService
    cashService: CashService
    salesService: SalesService
    serviceOrderService: ServiceOrderService
    historyService: HistoryService
    dashboardService: DashboardService
    auditService: AuditService
    exportService: ExportService
    intelligenceService: IntelligenceService
    aiService: AiService
    authenticate: (request: FastifyRequest) => Promise<void>
    authorize: (roles: readonly UserRole[]) => (request: FastifyRequest) => Promise<void>
  }

  interface FastifyRequest {
    auth: AuthenticatedUser | null
  }
}
