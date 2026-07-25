import { sql, type Kysely } from "kysely"
import type { Database, ProductType } from "../../database/types.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  Category,
  CostHistoryEntry,
  CostSource,
  PriceHistoryEntry,
  Product,
  ProductFilters,
  ProductList,
  Unit,
} from "./types.js"

export interface ProductRecord extends Product {
  categoryId: string
  unitId: string
}

export interface ProductWrite {
  sku: string | null
  barcode: string | null
  type: ProductType
  name: string
  description: string
  active: boolean
  minimumStock: number
  priceCents: number
  costCents: number | null
  costSource: CostSource | null
  categoryId: string
  unitId: string
}

export interface CatalogRepository {
  listCategories(tenantId: string, includeArchived: boolean): Promise<Category[]>
  getCategory(tenantId: string, id: string): Promise<Category | null>
  createCategory(user: AuthenticatedUser, name: string, active: boolean): Promise<Category>
  updateCategory(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: { name: string; active: boolean },
    before: Category,
  ): Promise<Category | null>
  archiveCategory(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: Category,
  ): Promise<boolean>
  categoryUsageCount(tenantId: string, id: string): Promise<number>

  listUnits(tenantId: string, includeArchived: boolean): Promise<Unit[]>
  getUnit(tenantId: string, id: string): Promise<Unit | null>
  createUnit(
    user: AuthenticatedUser,
    values: Omit<Unit, "id" | "version" | "createdAt" | "updatedAt">,
  ): Promise<Unit>
  updateUnit(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: Omit<Unit, "id" | "version" | "createdAt" | "updatedAt">,
    before: Unit,
  ): Promise<Unit | null>
  archiveUnit(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: Unit,
  ): Promise<boolean>
  unitUsageCount(tenantId: string, id: string): Promise<number>

  listProducts(tenantId: string, filters: ProductFilters): Promise<ProductList>
  getProduct(tenantId: string, id: string): Promise<ProductRecord | null>
  productExists(tenantId: string, id: string): Promise<boolean>
  createProduct(user: AuthenticatedUser, values: ProductWrite): Promise<ProductRecord>
  updateProduct(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: ProductWrite,
    before: ProductRecord,
    reason: string | null,
  ): Promise<ProductRecord | null>
  archiveProduct(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: ProductRecord,
  ): Promise<boolean>
  listPriceHistory(tenantId: string, productId: string): Promise<PriceHistoryEntry[]>
  listCostHistory(tenantId: string, productId: string): Promise<CostHistoryEntry[]>
}

interface ProductRow {
  id: string
  sku: string | null
  barcode: string | null
  type: ProductType
  name: string
  description: string
  active: boolean
  minimum_stock: string
  current_price_cents: number
  current_cost_cents: number | null
  cost_source: CostSource | null
  version: number
  created_at: Date
  updated_at: Date
  category_id: string
  category_name: string
  unit_id: string
  unit_name: string
  unit_abbreviation: string
  unit_allows_fractional: boolean
  unit_quantity_scale: number
}

function mapCategory(row: {
  id: string
  name: string
  active: boolean
  version: number
  created_at: Date
  updated_at: Date
}): Category {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapUnit(row: {
  id: string
  name: string
  abbreviation: string
  allows_fractional: boolean
  quantity_scale: number
  active: boolean
  version: number
  created_at: Date
  updated_at: Date
}): Unit {
  return {
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    allowsFractional: row.allows_fractional,
    quantityScale: row.quantity_scale,
    active: row.active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    type: row.type,
    name: row.name,
    description: row.description,
    active: row.active,
    minimumStock: Number(row.minimum_stock),
    priceCents: row.current_price_cents,
    costCents: row.current_cost_cents,
    costSource: row.cost_source,
    categoryId: row.category_id,
    unitId: row.unit_id,
    category: {
      id: row.category_id,
      name: row.category_name,
    },
    unit: {
      id: row.unit_id,
      name: row.unit_name,
      abbreviation: row.unit_abbreviation,
      allowsFractional: row.unit_allows_fractional,
      quantityScale: row.unit_quantity_scale,
    },
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function productSelection() {
  return [
    "product.id",
    "product.sku",
    "product.barcode",
    "product.type",
    "product.name",
    "product.description",
    "product.active",
    "product.minimum_stock",
    "product.current_price_cents",
    "product.current_cost_cents",
    "product.cost_source",
    "product.version",
    "product.created_at",
    "product.updated_at",
    "category.id as category_id",
    "category.name as category_name",
    "unit.id as unit_id",
    "unit.name as unit_name",
    "unit.abbreviation as unit_abbreviation",
    "unit.allows_fractional as unit_allows_fractional",
    "unit.quantity_scale as unit_quantity_scale",
  ] as const
}

async function insertAudit(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await database
    .insertInto("audit_events")
    .values({
      tenant_id: user.tenantId,
      actor_type: "user",
      actor_id: user.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      request_id: null,
      correlation_id: null,
      source: "api",
      reason: null,
      before_json: before,
      after_json: after,
      ip_address: null,
      user_agent: null,
    })
    .execute()
}

async function insertOutbox(
  database: Kysely<Database>,
  tenantId: string,
  eventType: string,
  aggregateId: string,
  payload: unknown,
): Promise<void> {
  await database
    .insertInto("outbox_events")
    .values({
      tenant_id: tenantId,
      event_type: eventType,
      aggregate_type: "product",
      aggregate_id: aggregateId,
      payload,
      status: "pending",
      last_error: null,
      processed_at: null,
    })
    .execute()
}

export class KyselyCatalogRepository implements CatalogRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listCategories(tenantId: string, includeArchived: boolean): Promise<Category[]> {
    let query = this.database
      .selectFrom("categories")
      .select(["id", "name", "active", "version", "created_at", "updated_at"])
      .where("tenant_id", "=", tenantId)
      .orderBy("name")
      .orderBy("id")

    if (!includeArchived) query = query.where("archived_at", "is", null)

    return (await query.execute()).map(mapCategory)
  }

  async getCategory(tenantId: string, id: string): Promise<Category | null> {
    const row = await this.database
      .selectFrom("categories")
      .select(["id", "name", "active", "version", "created_at", "updated_at"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirst()

    return row ? mapCategory(row) : null
  }

  async createCategory(
    user: AuthenticatedUser,
    name: string,
    active: boolean,
  ): Promise<Category> {
    const id = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto("categories")
        .values({
          tenant_id: user.tenantId,
          parent_id: null,
          name,
          active,
          created_by: user.id,
          updated_by: user.id,
          archived_at: null,
        })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow()

      await insertAudit(transaction, user, "category.created", "category", row.id, null, {
        name,
        active,
      })
      return row.id
    })

    const category = await this.getCategory(user.tenantId, id)
    if (!category) throw new Error("Created category could not be reloaded")
    return category
  }

  async updateCategory(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: { name: string; active: boolean },
    before: Category,
  ): Promise<Category | null> {
    const updated = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("categories")
        .set({
          name: values.name,
          active: values.active,
          updated_by: user.id,
          updated_at: new Date(),
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false
      await insertAudit(transaction, user, "category.updated", "category", id, before, values)
      return true
    })

    return updated ? this.getCategory(user.tenantId, id) : null
  }

  async archiveCategory(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: Category,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("categories")
        .set({
          active: false,
          archived_at: new Date(),
          updated_at: new Date(),
          updated_by: user.id,
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false
      await insertAudit(transaction, user, "category.archived", "category", id, before, null)
      return true
    })
  }

  async categoryUsageCount(tenantId: string, id: string): Promise<number> {
    const row = await this.database
      .selectFrom("products")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("category_id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirstOrThrow()

    return Number(row.count)
  }

  async listUnits(tenantId: string, includeArchived: boolean): Promise<Unit[]> {
    let query = this.database
      .selectFrom("units")
      .select([
        "id",
        "name",
        "abbreviation",
        "allows_fractional",
        "quantity_scale",
        "active",
        "version",
        "created_at",
        "updated_at",
      ])
      .where("tenant_id", "=", tenantId)
      .orderBy("name")
      .orderBy("id")

    if (!includeArchived) query = query.where("archived_at", "is", null)

    return (await query.execute()).map(mapUnit)
  }

  async getUnit(tenantId: string, id: string): Promise<Unit | null> {
    const row = await this.database
      .selectFrom("units")
      .select([
        "id",
        "name",
        "abbreviation",
        "allows_fractional",
        "quantity_scale",
        "active",
        "version",
        "created_at",
        "updated_at",
      ])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirst()

    return row ? mapUnit(row) : null
  }

  async createUnit(
    user: AuthenticatedUser,
    values: Omit<Unit, "id" | "version" | "createdAt" | "updatedAt">,
  ): Promise<Unit> {
    const id = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto("units")
        .values({
          tenant_id: user.tenantId,
          name: values.name,
          abbreviation: values.abbreviation,
          allows_fractional: values.allowsFractional,
          quantity_scale: values.quantityScale,
          active: values.active,
          created_by: user.id,
          updated_by: user.id,
          archived_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow()

      await insertAudit(transaction, user, "unit.created", "unit", row.id, null, values)
      return row.id
    })

    const unit = await this.getUnit(user.tenantId, id)
    if (!unit) throw new Error("Created unit could not be reloaded")
    return unit
  }

  async updateUnit(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: Omit<Unit, "id" | "version" | "createdAt" | "updatedAt">,
    before: Unit,
  ): Promise<Unit | null> {
    const updated = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("units")
        .set({
          name: values.name,
          abbreviation: values.abbreviation,
          allows_fractional: values.allowsFractional,
          quantity_scale: values.quantityScale,
          active: values.active,
          updated_by: user.id,
          updated_at: new Date(),
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false
      await insertAudit(transaction, user, "unit.updated", "unit", id, before, values)
      return true
    })

    return updated ? this.getUnit(user.tenantId, id) : null
  }

  async archiveUnit(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: Unit,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("units")
        .set({
          active: false,
          archived_at: new Date(),
          updated_at: new Date(),
          updated_by: user.id,
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false
      await insertAudit(transaction, user, "unit.archived", "unit", id, before, null)
      return true
    })
  }

  async unitUsageCount(tenantId: string, id: string): Promise<number> {
    const row = await this.database
      .selectFrom("products")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("unit_id", "=", id)
      .where("archived_at", "is", null)
      .executeTakeFirstOrThrow()

    return Number(row.count)
  }

  async listProducts(tenantId: string, filters: ProductFilters): Promise<ProductList> {
    let query = this.database
      .selectFrom("products as product")
      .innerJoin("categories as category", "category.id", "product.category_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select(productSelection())
      .where("product.tenant_id", "=", tenantId)
      .where("product.archived_at", "is", null)

    let countQuery = this.database
      .selectFrom("products as product")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("product.tenant_id", "=", tenantId)
      .where("product.archived_at", "is", null)

    if (filters.search) {
      const pattern = `%${filters.search}%`
      query = query.where((expression) => expression.or([
        expression("product.name", "ilike", pattern),
        expression("product.sku", "ilike", pattern),
        expression("product.barcode", "ilike", pattern),
      ]))
      countQuery = countQuery.where((expression) => expression.or([
        expression("product.name", "ilike", pattern),
        expression("product.sku", "ilike", pattern),
        expression("product.barcode", "ilike", pattern),
      ]))
    }

    if (filters.categoryId) {
      query = query.where("product.category_id", "=", filters.categoryId)
      countQuery = countQuery.where("product.category_id", "=", filters.categoryId)
    }
    if (filters.type) {
      query = query.where("product.type", "=", filters.type)
      countQuery = countQuery.where("product.type", "=", filters.type)
    }
    if (filters.active !== undefined) {
      query = query.where("product.active", "=", filters.active)
      countQuery = countQuery.where("product.active", "=", filters.active)
    }

    const [rows, count] = await Promise.all([
      query
        .orderBy("product.name")
        .orderBy("product.id")
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize)
        .execute() as Promise<ProductRow[]>,
      countQuery.executeTakeFirstOrThrow(),
    ])

    return {
      data: rows.map(mapProduct),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(count.count),
    }
  }

  async getProduct(tenantId: string, id: string): Promise<ProductRecord | null> {
    const row = await this.database
      .selectFrom("products as product")
      .innerJoin("categories as category", "category.id", "product.category_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select(productSelection())
      .where("product.tenant_id", "=", tenantId)
      .where("product.id", "=", id)
      .where("product.archived_at", "is", null)
      .executeTakeFirst() as ProductRow | undefined

    return row ? mapProduct(row) : null
  }

  async productExists(tenantId: string, id: string): Promise<boolean> {
    const row = await this.database
      .selectFrom("products")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst()

    return row !== undefined
  }

  async createProduct(
    user: AuthenticatedUser,
    values: ProductWrite,
  ): Promise<ProductRecord> {
    const id = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto("products")
        .values({
          tenant_id: user.tenantId,
          category_id: values.categoryId,
          unit_id: values.unitId,
          sku: values.sku,
          barcode: values.barcode,
          type: values.type,
          name: values.name,
          description: values.description,
          active: values.active,
          minimum_stock: values.minimumStock,
          current_price_cents: values.priceCents,
          current_cost_cents: values.costCents,
          cost_source: values.costSource,
          created_by: user.id,
          updated_by: user.id,
          archived_at: null,
        })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow()

      await transaction.insertInto("product_price_history").values({
        tenant_id: user.tenantId,
        product_id: row.id,
        old_price_cents: null,
        new_price_cents: values.priceCents,
        actor_id: user.id,
        reason: "Product created.",
      }).execute()

      if (values.costCents !== null) {
        await transaction.insertInto("product_cost_history").values({
          tenant_id: user.tenantId,
          product_id: row.id,
          old_cost_cents: null,
          new_cost_cents: values.costCents,
          source: values.costSource,
          actor_id: user.id,
          reason: "Product created.",
        }).execute()
      }

      if (values.type !== "service") {
        await transaction.insertInto("inventory_balances").values({
          tenant_id: user.tenantId,
          product_id: row.id,
          on_hand: 0,
          reserved: 0,
          average_unit_cost_cents: null,
        }).execute()
        if (values.active) {
          await transaction.insertInto("stockout_intervals").values({
            tenant_id: user.tenantId,
            product_id: row.id,
            started_at: row.created_at,
            ended_at: null,
            detected_reason: "product_created_without_stock",
            source_movement_id: null,
            ended_by_movement_id: null,
          }).execute()
        }
      }

      await insertAudit(transaction, user, "product.created", "product", row.id, null, values)
      await insertOutbox(transaction, user.tenantId, "product.created", row.id, values)
      return row.id
    })

    const product = await this.getProduct(user.tenantId, id)
    if (!product) throw new Error("Created product could not be reloaded")
    return product
  }

  async updateProduct(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    values: ProductWrite,
    before: ProductRecord,
    reason: string | null,
  ): Promise<ProductRecord | null> {
    const priceChanged = before.priceCents !== values.priceCents
    const costChanged = before.costCents !== values.costCents
      || before.costSource !== values.costSource
    const changeReason = reason ?? ""
    if ((priceChanged || costChanged) && !changeReason) {
      throw new Error("Price and cost history require a change reason")
    }

    const updated = await this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("products")
        .set({
          category_id: values.categoryId,
          unit_id: values.unitId,
          sku: values.sku,
          barcode: values.barcode,
          type: values.type,
          name: values.name,
          description: values.description,
          active: values.active,
          minimum_stock: values.minimumStock,
          current_price_cents: values.priceCents,
          current_cost_cents: values.costCents,
          cost_source: values.costSource,
          updated_by: user.id,
          updated_at: new Date(),
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false

      if (before.active !== values.active && before.type !== "service") {
        if (values.active) {
          const balance = await transaction.selectFrom("inventory_balances")
            .select("on_hand").where("tenant_id", "=", user.tenantId)
            .where("product_id", "=", id).executeTakeFirstOrThrow()
          if (Number(balance.on_hand) <= 0) {
            await transaction.insertInto("stockout_intervals").values({
              tenant_id: user.tenantId,
              product_id: id,
              started_at: new Date(),
              ended_at: null,
              detected_reason: "product_activated_without_stock",
              source_movement_id: null,
              ended_by_movement_id: null,
            }).onConflict((conflict) => conflict
              .columns(["tenant_id", "product_id"])
              .where("ended_at", "is", null)
              .doNothing())
              .execute()
          }
        } else {
          await transaction.updateTable("stockout_intervals").set({
            ended_at: new Date(),
          }).where("tenant_id", "=", user.tenantId).where("product_id", "=", id)
            .where("ended_at", "is", null).execute()
        }
      }

      if (priceChanged) {
        await transaction.insertInto("product_price_history").values({
          tenant_id: user.tenantId,
          product_id: id,
          old_price_cents: before.priceCents,
          new_price_cents: values.priceCents,
          actor_id: user.id,
          reason: changeReason,
        }).execute()
        await insertOutbox(transaction, user.tenantId, "product.price_changed", id, {
          oldPriceCents: before.priceCents,
          newPriceCents: values.priceCents,
        })
      }

      if (costChanged) {
        await transaction.insertInto("product_cost_history").values({
          tenant_id: user.tenantId,
          product_id: id,
          old_cost_cents: before.costCents,
          new_cost_cents: values.costCents,
          source: values.costSource,
          actor_id: user.id,
          reason: changeReason,
        }).execute()
        await insertOutbox(transaction, user.tenantId, "product.cost_changed", id, {
          oldCostCents: before.costCents,
          newCostCents: values.costCents,
          source: values.costSource,
        })
      }

      await insertAudit(transaction, user, "product.updated", "product", id, before, values)
      await insertOutbox(transaction, user.tenantId, "product.updated", id, values)
      return true
    })

    return updated ? this.getProduct(user.tenantId, id) : null
  }

  async archiveProduct(
    user: AuthenticatedUser,
    id: string,
    expectedVersion: number,
    before: ProductRecord,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .updateTable("products")
        .set({
          active: false,
          archived_at: new Date(),
          updated_at: new Date(),
          updated_by: user.id,
          version: sql`version + 1`,
        })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", id)
        .where("version", "=", expectedVersion)
        .where("archived_at", "is", null)
        .returning("id")
        .executeTakeFirst()

      if (!row) return false
      await transaction.updateTable("stockout_intervals").set({
        ended_at: new Date(),
      }).where("tenant_id", "=", user.tenantId).where("product_id", "=", id)
        .where("ended_at", "is", null).execute()
      await insertAudit(transaction, user, "product.archived", "product", id, before, null)
      await insertOutbox(transaction, user.tenantId, "product.archived", id, {
        productId: id,
      })
      return true
    })
  }

  async listPriceHistory(
    tenantId: string,
    productId: string,
  ): Promise<PriceHistoryEntry[]> {
    const rows = await this.database
      .selectFrom("product_price_history")
      .select([
        "id",
        "old_price_cents",
        "new_price_cents",
        "reason",
        "actor_id",
        "effective_at",
      ])
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", productId)
      .orderBy("effective_at", "desc")
      .orderBy("id", "desc")
      .execute()

    return rows.map((row) => ({
      id: row.id,
      oldPriceCents: row.old_price_cents,
      newPriceCents: row.new_price_cents,
      reason: row.reason,
      actorId: row.actor_id,
      effectiveAt: row.effective_at.toISOString(),
    }))
  }

  async listCostHistory(
    tenantId: string,
    productId: string,
  ): Promise<CostHistoryEntry[]> {
    const rows = await this.database
      .selectFrom("product_cost_history")
      .select([
        "id",
        "old_cost_cents",
        "new_cost_cents",
        "source",
        "reason",
        "actor_id",
        "effective_at",
      ])
      .where("tenant_id", "=", tenantId)
      .where("product_id", "=", productId)
      .orderBy("effective_at", "desc")
      .orderBy("id", "desc")
      .execute()

    return rows.map((row) => ({
      id: row.id,
      oldCostCents: row.old_cost_cents,
      newCostCents: row.new_cost_cents,
      source: row.source,
      reason: row.reason,
      actorId: row.actor_id,
      effectiveAt: row.effective_at.toISOString(),
    }))
  }
}
