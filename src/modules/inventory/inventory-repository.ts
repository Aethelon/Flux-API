import { sql, type Kysely } from "kysely"
import type {
  Database,
  ProductType,
  StockMovementType,
} from "../../database/types.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import { currentCorrelationId } from "../../shared/observability/request-context.js"
import type {
  BalanceFilters,
  CreateManualMovementInput,
  InventoryBalance,
  InventoryBalanceList,
  InventoryStatus,
  MovementPage,
  MovementFilters,
  StockMovement,
} from "./types.js"
import { recordInventoryTracking } from "./inventory-tracking.js"

export interface StockProductRecord {
  id: string
  type: ProductType
  active: boolean
  quantityScale: number
}

export interface InventoryRepository {
  getStockProduct(tenantId: string, productId: string): Promise<StockProductRecord | null>
  getBalance(tenantId: string, productId: string): Promise<InventoryBalance | null>
  listBalances(tenantId: string, filters: BalanceFilters): Promise<InventoryBalanceList>
  listMovements(tenantId: string, filters: MovementFilters): Promise<MovementPage>
  postManualMovement(
    user: AuthenticatedUser,
    input: CreateManualMovementInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockMovement | null>
}

interface BalanceRow {
  product_id: string
  product_sku: string | null
  product_barcode: string | null
  product_type: Exclude<ProductType, "service">
  product_name: string
  product_active: boolean
  minimum_stock: string
  category_id: string
  category_name: string
  unit_id: string
  unit_name: string
  unit_abbreviation: string
  unit_quantity_scale: number
  on_hand: string
  reserved: string
  average_unit_cost_cents: string | null
  version: number
  updated_at: Date
}

interface MovementRow {
  id: string
  product_id: string
  product_name: string
  product_sku: string | null
  unit_abbreviation: string
  movement_type: StockMovementType
  quantity: string
  resulting_on_hand: string
  resulting_reserved: string
  unit_cost_snapshot_cents: string | null
  source_type: string
  source_id: string | null
  source_reference: string | null
  reason: string
  actor_user_id: string
  actor_name: string
  occurred_at: Date
  reversal_of_id: string | null
}

function inventoryStatus(
  active: boolean,
  onHand: number,
  minimumStock: number,
): InventoryStatus {
  if (!active) return "inactive"
  if (onHand <= 0) return "sold_out"
  if (onHand <= minimumStock) return "low_stock"
  return "available"
}

function mapBalance(row: BalanceRow): InventoryBalance {
  const onHand = Number(row.on_hand)
  const reserved = Number(row.reserved)
  const minimumStock = Number(row.minimum_stock)
  const averageUnitCostCents = row.average_unit_cost_cents === null
    ? null
    : Number(row.average_unit_cost_cents)

  return {
    product: {
      id: row.product_id,
      sku: row.product_sku,
      barcode: row.product_barcode,
      type: row.product_type,
      name: row.product_name,
      active: row.product_active,
      minimumStock,
      category: {
        id: row.category_id,
        name: row.category_name,
      },
      unit: {
        id: row.unit_id,
        name: row.unit_name,
        abbreviation: row.unit_abbreviation,
        quantityScale: row.unit_quantity_scale,
      },
    },
    onHand,
    reserved,
    available: onHand - reserved,
    averageUnitCostCents,
    inventoryValueCents: averageUnitCostCents === null
      ? null
      : onHand * averageUnitCostCents,
    status: inventoryStatus(row.product_active, onHand, minimumStock),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    product: {
      id: row.product_id,
      name: row.product_name,
      sku: row.product_sku,
      unitAbbreviation: row.unit_abbreviation,
    },
    type: row.movement_type,
    quantity: Number(row.quantity),
    resultingOnHand: Number(row.resulting_on_hand),
    resultingReserved: Number(row.resulting_reserved),
    unitCostSnapshotCents: row.unit_cost_snapshot_cents === null
      ? null
      : Number(row.unit_cost_snapshot_cents),
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceReference: row.source_reference,
    reason: row.reason,
    actor: {
      id: row.actor_user_id,
      name: row.actor_name,
    },
    occurredAt: row.occurred_at.toISOString(),
    reversalOfId: row.reversal_of_id,
  }
}

function balanceSelection() {
  return [
    "product.id as product_id",
    "product.sku as product_sku",
    "product.barcode as product_barcode",
    "product.type as product_type",
    "product.name as product_name",
    "product.active as product_active",
    "product.minimum_stock",
    "category.id as category_id",
    "category.name as category_name",
    "unit.id as unit_id",
    "unit.name as unit_name",
    "unit.abbreviation as unit_abbreviation",
    "unit.quantity_scale as unit_quantity_scale",
    "balance.on_hand",
    "balance.reserved",
    "balance.average_unit_cost_cents",
    "balance.version",
    "balance.updated_at",
  ] as const
}

function movementSelection() {
  return [
    "movement.id",
    "product.id as product_id",
    "product.name as product_name",
    "product.sku as product_sku",
    "unit.abbreviation as unit_abbreviation",
    "movement.movement_type",
    "movement.quantity",
    "movement.resulting_on_hand",
    "movement.resulting_reserved",
    "movement.unit_cost_snapshot_cents",
    "movement.source_type",
    "movement.source_id",
    "movement.source_reference",
    "movement.reason",
    "actor.id as actor_user_id",
    "actor.name as actor_name",
    "movement.occurred_at",
    "movement.reversal_of_id",
  ] as const
}

function replayMovementId(response: unknown): string | null {
  if (
    typeof response === "object"
    && response !== null
    && "movementId" in response
    && typeof response.movementId === "string"
  ) {
    return response.movementId
  }
  return null
}

function statusPredicate(status: InventoryStatus) {
  switch (status) {
    case "inactive":
      return sql<boolean>`NOT product.active`
    case "sold_out":
      return sql<boolean>`product.active AND balance.on_hand <= 0`
    case "low_stock":
      return sql<boolean>`
        product.active
        AND balance.on_hand > 0
        AND balance.on_hand <= product.minimum_stock
      `
    case "available":
      return sql<boolean>`
        product.active AND balance.on_hand > product.minimum_stock
      `
  }
}

export class KyselyInventoryRepository implements InventoryRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async getStockProduct(
    tenantId: string,
    productId: string,
  ): Promise<StockProductRecord | null> {
    const row = await this.database
      .selectFrom("products as product")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select([
        "product.id",
        "product.type",
        "product.active",
        "unit.quantity_scale",
      ])
      .where("product.tenant_id", "=", tenantId)
      .where("product.id", "=", productId)
      .where("product.archived_at", "is", null)
      .executeTakeFirst()

    return row
      ? {
          id: row.id,
          type: row.type,
          active: row.active,
          quantityScale: row.quantity_scale,
        }
      : null
  }

  async getBalance(
    tenantId: string,
    productId: string,
  ): Promise<InventoryBalance | null> {
    const row = await this.database
      .selectFrom("inventory_balances as balance")
      .innerJoin("products as product", "product.id", "balance.product_id")
      .innerJoin("categories as category", "category.id", "product.category_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select(balanceSelection())
      .where("balance.tenant_id", "=", tenantId)
      .where("balance.product_id", "=", productId)
      .executeTakeFirst() as BalanceRow | undefined

    return row ? mapBalance(row) : null
  }

  async listBalances(
    tenantId: string,
    filters: BalanceFilters,
  ): Promise<InventoryBalanceList> {
    let query = this.database
      .selectFrom("inventory_balances as balance")
      .innerJoin("products as product", "product.id", "balance.product_id")
      .innerJoin("categories as category", "category.id", "product.category_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select(balanceSelection())
      .where("balance.tenant_id", "=", tenantId)
      .where("product.archived_at", "is", null)

    let countQuery = this.database
      .selectFrom("inventory_balances as balance")
      .innerJoin("products as product", "product.id", "balance.product_id")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("balance.tenant_id", "=", tenantId)
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
    if (filters.status) {
      query = query.where(statusPredicate(filters.status))
      countQuery = countQuery.where(statusPredicate(filters.status))
    }

    const [rows, count] = await Promise.all([
      query
        .orderBy("product.name")
        .orderBy("product.id")
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize)
        .execute() as Promise<BalanceRow[]>,
      countQuery.executeTakeFirstOrThrow(),
    ])

    return {
      data: rows.map(mapBalance),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(count.count),
    }
  }

  async listMovements(
    tenantId: string,
    filters: MovementFilters,
  ): Promise<MovementPage> {
    let query = this.database
      .selectFrom("stock_movements as movement")
      .innerJoin("products as product", "product.id", "movement.product_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .innerJoin("users as actor", "actor.id", "movement.actor_user_id")
      .select(movementSelection())
      .where("movement.tenant_id", "=", tenantId)

    if (filters.productId) {
      query = query.where("movement.product_id", "=", filters.productId)
    }
    if (filters.type) {
      query = query.where("movement.movement_type", "=", filters.type)
    }
    if (filters.cursor) {
      query = query.where(sql<boolean>`
        (movement.occurred_at, movement.id)
        < (${new Date(filters.cursor.occurredAt)}, ${filters.cursor.id}::uuid)
      `)
    }

    const rows = await query
      .orderBy("movement.occurred_at", "desc")
      .orderBy("movement.id", "desc")
      .limit(filters.limit + 1)
      .execute() as MovementRow[]
    const hasMore = rows.length > filters.limit

    return {
      data: rows.slice(0, filters.limit).map(mapMovement),
      hasMore,
    }
  }

  async postManualMovement(
    user: AuthenticatedUser,
    input: CreateManualMovementInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockMovement | null> {
    const movementId = await this.database.transaction().execute(async (transaction) => {
      const route = "POST /api/v1/inventory/movements"
      const lockKey = `${user.tenantId}:${user.id}:${route}:${idempotencyKey}`
      await sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `.execute(transaction)

      const existing = await transaction
        .selectFrom("idempotency_records")
        .select(["request_hash", "response_body"])
        .where("tenant_id", "=", user.tenantId)
        .where("user_id", "=", user.id)
        .where("route", "=", route)
        .where("idempotency_key", "=", idempotencyKey)
        .executeTakeFirst()

      if (existing) {
        if (existing.request_hash !== requestHash) {
          throw new AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used with different request data.",
          )
        }
        const replayId = replayMovementId(existing.response_body)
        if (!replayId) {
          throw new AppError(
            409,
            "IDEMPOTENCY_RESULT_UNAVAILABLE",
            "The previous request result is not available for replay.",
          )
        }
        return replayId
      }

      const product = await transaction
        .selectFrom("products")
        .select(["id", "active", "type", "current_cost_cents"])
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", input.productId)
        .where("archived_at", "is", null)
        .forUpdate()
        .executeTakeFirst()

      if (!product || !product.active || product.type === "service") return null

      await transaction
        .insertInto("inventory_balances")
        .values({
          tenant_id: user.tenantId,
          product_id: input.productId,
          on_hand: 0,
          reserved: 0,
          average_unit_cost_cents: null,
        })
        .onConflict((conflict) => conflict
          .columns(["tenant_id", "product_id"])
          .doNothing())
        .execute()

      const balance = await transaction
        .selectFrom("inventory_balances")
        .select(["on_hand", "reserved", "average_unit_cost_cents"])
        .where("tenant_id", "=", user.tenantId)
        .where("product_id", "=", input.productId)
        .forUpdate()
        .executeTakeFirstOrThrow()

      const oldOnHand = Number(balance.on_hand)
      const reserved = Number(balance.reserved)
      const oldAverageCost = balance.average_unit_cost_cents === null
        ? null
        : Number(balance.average_unit_cost_cents)
      const quantity = input.type === "negative_adjustment"
        ? -input.quantity
        : input.quantity
      const newOnHand = oldOnHand + quantity

      if (newOnHand < reserved) return null

      const inputCost = input.unitCostCents ?? null
      const newAverageCost = quantity > 0 && inputCost !== null
        ? oldOnHand > 0 && oldAverageCost !== null
          ? ((oldOnHand * oldAverageCost) + (input.quantity * inputCost)) / newOnHand
          : inputCost
        : oldAverageCost
      const roundedAverageCost = newAverageCost === null
        ? null
        : Math.round(newAverageCost * 1_000_000) / 1_000_000
      const costSnapshot = quantity > 0 ? inputCost : oldAverageCost

      await transaction
        .updateTable("inventory_balances")
        .set({
          on_hand: newOnHand,
          average_unit_cost_cents: roundedAverageCost,
          version: sql`version + 1`,
          updated_at: new Date(),
        })
        .where("tenant_id", "=", user.tenantId)
        .where("product_id", "=", input.productId)
        .execute()

      const occurredAt = new Date()
      const movement = await transaction
        .insertInto("stock_movements")
        .values({
          tenant_id: user.tenantId,
          product_id: input.productId,
          movement_type: input.type,
          quantity,
          resulting_on_hand: newOnHand,
          resulting_reserved: reserved,
          unit_cost_snapshot_cents: costSnapshot,
          source_type: input.type === "receipt" ? "manual_receipt" : "manual_adjustment",
          source_id: null,
          source_reference: input.sourceReference?.trim() || null,
          reason: input.reason.trim(),
          actor_user_id: user.id,
          occurred_at: occurredAt,
          reversal_of_id: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow()

      await recordInventoryTracking(transaction, {
        tenantId: user.tenantId,
        productId: input.productId,
        movementId: movement.id,
        movementType: input.type,
        quantity,
        oldOnHand,
        newOnHand,
        reserved,
        occurredAt,
      })

      const currentRoundedCost = product.current_cost_cents
      const nextRoundedCost = roundedAverageCost === null
        ? null
        : Math.round(roundedAverageCost)
      if (nextRoundedCost !== null && nextRoundedCost !== currentRoundedCost) {
        await transaction.updateTable("products").set({
          current_cost_cents: nextRoundedCost,
          cost_source: "moving_average",
          updated_by: user.id,
          updated_at: new Date(),
          version: sql`version + 1`,
        })
          .where("tenant_id", "=", user.tenantId)
          .where("id", "=", input.productId)
          .execute()

        await transaction.insertInto("product_cost_history").values({
          tenant_id: user.tenantId,
          product_id: input.productId,
          old_cost_cents: currentRoundedCost,
          new_cost_cents: nextRoundedCost,
          source: "moving_average",
          actor_id: user.id,
          reason: input.reason.trim(),
        }).execute()
      }

      const eventPayload = {
        movementId: movement.id,
        productId: input.productId,
        type: input.type,
        quantity,
        resultingOnHand: newOnHand,
        resultingReserved: reserved,
        unitCostSnapshotCents: costSnapshot,
        reason: input.reason.trim(),
      }
      const correlationId = currentCorrelationId()
      await transaction.insertInto("audit_events").values({
        tenant_id: user.tenantId,
        actor_type: "user",
        actor_id: user.id,
        action: "inventory.movement_posted",
        entity_type: "stock_movement",
        entity_id: movement.id,
        request_id: correlationId,
        correlation_id: correlationId,
        source: "api",
        reason: input.reason.trim(),
        before_json: null,
        after_json: eventPayload,
        ip_address: null,
        user_agent: null,
      }).execute()
      await transaction.insertInto("outbox_events").values({
        tenant_id: user.tenantId,
        event_type: "inventory.movement_posted",
        aggregate_type: "product",
        aggregate_id: input.productId,
        correlation_id: correlationId,
        payload: eventPayload,
        status: "pending",
        last_error: null,
        processed_at: null,
      }).execute()
      await transaction.insertInto("idempotency_records").values({
        tenant_id: user.tenantId,
        user_id: user.id,
        route,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_status: 201,
        response_body: {
          movementId: movement.id,
        },
        expires_at: new Date(Date.now() + (24 * 60 * 60 * 1_000)),
      }).execute()

      return movement.id
    })

    if (!movementId) return null
    const movement = await this.getMovement(user.tenantId, movementId)
    if (!movement) throw new Error("Created stock movement could not be reloaded")

    return movement
  }

  private async getMovement(
    tenantId: string,
    movementId: string,
  ): Promise<StockMovement | null> {
    const row = await this.database
      .selectFrom("stock_movements as movement")
      .innerJoin("products as product", "product.id", "movement.product_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .innerJoin("users as actor", "actor.id", "movement.actor_user_id")
      .select(movementSelection())
      .where("movement.tenant_id", "=", tenantId)
      .where("movement.id", "=", movementId)
      .executeTakeFirst() as MovementRow | undefined

    return row ? mapMovement(row) : null
  }
}
