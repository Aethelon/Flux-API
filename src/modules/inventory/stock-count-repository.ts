import { sql, type Kysely } from "kysely"
import type {
  Database,
  StockCountStatus,
} from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import { currentCorrelationId } from "../../shared/observability/request-context.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { recordInventoryTracking } from "./inventory-tracking.js"
import type {
  CancelStockCountInput,
  ConfirmStockCountInput,
  CreateStockCountInput,
  StockCount,
  StockCountFilters,
  StockCountList,
} from "./types.js"

export interface StockCountRepository {
  list(tenantId: string, filters: StockCountFilters): Promise<StockCountList>
  get(tenantId: string, countId: string): Promise<StockCount | null>
  create(
    user: AuthenticatedUser,
    input: CreateStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount>
  confirm(
    user: AuthenticatedUser,
    countId: string,
    input: ConfirmStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount>
  cancel(
    user: AuthenticatedUser,
    countId: string,
    input: CancelStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount>
}

interface CountRow {
  id: string
  status: StockCountStatus
  reason: string
  started_by_id: string
  started_by_name: string
  started_at: Date
  confirmed_by_id: string | null
  confirmed_by_name: string | null
  confirmed_at: Date | null
  cancelled_by_id: string | null
  cancelled_by_name: string | null
  cancelled_at: Date | null
  cancellation_reason: string | null
  version: number
}

interface CountItemRow {
  id: string
  product_id: string
  product_name: string
  product_sku: string | null
  unit_abbreviation: string
  unit_quantity_scale: number
  expected_quantity: string
  counted_quantity: string | null
  difference: string | null
  unit_cost_snapshot_cents: string | null
  movement_id: string | null
}

function countSelection() {
  return [
    "count.id",
    "count.status",
    "count.reason",
    "starter.id as started_by_id",
    "starter.name as started_by_name",
    "count.started_at",
    "confirmer.id as confirmed_by_id",
    "confirmer.name as confirmed_by_name",
    "count.confirmed_at",
    "canceller.id as cancelled_by_id",
    "canceller.name as cancelled_by_name",
    "count.cancelled_at",
    "count.cancellation_reason",
    "count.version",
  ] as const
}

function countQuery(database: Kysely<Database>) {
  return database
    .selectFrom("stock_counts as count")
    .innerJoin("users as starter", "starter.id", "count.started_by")
    .leftJoin("users as confirmer", "confirmer.id", "count.confirmed_by")
    .leftJoin("users as canceller", "canceller.id", "count.cancelled_by")
}

function mapCountHeader(row: CountRow): Omit<StockCount, "items"> {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    startedBy: {
      id: row.started_by_id,
      name: row.started_by_name,
    },
    startedAt: row.started_at.toISOString(),
    confirmedBy: row.confirmed_by_id && row.confirmed_by_name
      ? {
          id: row.confirmed_by_id,
          name: row.confirmed_by_name,
        }
      : null,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by_id && row.cancelled_by_name
      ? {
          id: row.cancelled_by_id,
          name: row.cancelled_by_name,
        }
      : null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancellationReason: row.cancellation_reason,
    version: row.version,
  }
}

function responseCountId(response: unknown): string | null {
  return typeof response === "object"
    && response !== null
    && "countId" in response
    && typeof response.countId === "string"
    ? response.countId
    : null
}

async function replayedCountId(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  route: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<string | null> {
  const lockKey = `${user.tenantId}:${user.id}:${route}:${idempotencyKey}`
  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `.execute(database)

  const existing = await database
    .selectFrom("idempotency_records")
    .select(["request_hash", "response_body"])
    .where("tenant_id", "=", user.tenantId)
    .where("user_id", "=", user.id)
    .where("route", "=", route)
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst()

  if (!existing) return null
  if (existing.request_hash !== requestHash) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "The idempotency key was already used with different request data.",
    )
  }

  const countId = responseCountId(existing.response_body)
  if (!countId) {
    throw new AppError(
      409,
      "IDEMPOTENCY_RESULT_UNAVAILABLE",
      "The previous request result is not available for replay.",
    )
  }
  return countId
}

async function saveIdempotency(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  route: string,
  idempotencyKey: string,
  requestHash: string,
  countId: string,
  responseStatus: number,
): Promise<void> {
  await database.insertInto("idempotency_records").values({
    tenant_id: user.tenantId,
    user_id: user.id,
    route,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    response_status: responseStatus,
    response_body: { countId },
    expires_at: new Date(Date.now() + (24 * 60 * 60 * 1_000)),
  }).execute()
}

async function insertCountEvent(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  countId: string,
  action: string,
  reason: string,
  payload: unknown,
): Promise<void> {
  const correlationId = currentCorrelationId()
  await database.insertInto("audit_events").values({
    tenant_id: user.tenantId,
    actor_type: "user",
    actor_id: user.id,
    action,
    entity_type: "stock_count",
    entity_id: countId,
    request_id: correlationId,
    correlation_id: correlationId,
    source: "api",
    reason,
    before_json: null,
    after_json: payload,
    ip_address: null,
    user_agent: null,
  }).execute()

  await database.insertInto("outbox_events").values({
    tenant_id: user.tenantId,
    event_type: action,
    aggregate_type: "stock_count",
    aggregate_id: countId,
    correlation_id: correlationId,
    payload,
    status: "pending",
    last_error: null,
    processed_at: null,
  }).execute()
}

export class KyselyStockCountRepository implements StockCountRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async list(tenantId: string, filters: StockCountFilters): Promise<StockCountList> {
    let query = countQuery(this.database)
      .select([
        ...countSelection(),
        (expression) => expression
          .selectFrom("stock_count_items")
          .select((nested) => nested.fn.countAll<number>().as("item_count"))
          .whereRef("stock_count_items.stock_count_id", "=", "count.id")
          .as("item_count"),
      ])
      .where("count.tenant_id", "=", tenantId)

    let countRows = this.database
      .selectFrom("stock_counts")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)

    if (filters.status) {
      query = query.where("count.status", "=", filters.status)
      countRows = countRows.where("status", "=", filters.status)
    }

    const [rows, total] = await Promise.all([
      query
        .orderBy("count.started_at", "desc")
        .orderBy("count.id", "desc")
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize)
        .execute(),
      countRows.executeTakeFirstOrThrow(),
    ])

    return {
      data: rows.map((row) => ({
        ...mapCountHeader(row as CountRow),
        itemCount: Number(row.item_count),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(total.count),
    }
  }

  async get(tenantId: string, countId: string): Promise<StockCount | null> {
    const row = await countQuery(this.database)
      .select(countSelection())
      .where("count.tenant_id", "=", tenantId)
      .where("count.id", "=", countId)
      .executeTakeFirst() as CountRow | undefined

    if (!row) return null

    const items = await this.database
      .selectFrom("stock_count_items as item")
      .innerJoin("products as product", "product.id", "item.product_id")
      .innerJoin("units as unit", "unit.id", "product.unit_id")
      .select([
        "item.id",
        "product.id as product_id",
        "product.name as product_name",
        "product.sku as product_sku",
        "unit.abbreviation as unit_abbreviation",
        "unit.quantity_scale as unit_quantity_scale",
        "item.expected_quantity",
        "item.counted_quantity",
        "item.difference",
        "item.unit_cost_snapshot_cents",
        "item.movement_id",
      ])
      .where("item.tenant_id", "=", tenantId)
      .where("item.stock_count_id", "=", countId)
      .orderBy("product.name")
      .orderBy("product.id")
      .execute() as CountItemRow[]

    return {
      ...mapCountHeader(row),
      items: items.map((item) => ({
        id: item.id,
        product: {
          id: item.product_id,
          name: item.product_name,
          sku: item.product_sku,
          unitAbbreviation: item.unit_abbreviation,
          quantityScale: item.unit_quantity_scale,
        },
        expectedQuantity: Number(item.expected_quantity),
        countedQuantity: item.counted_quantity === null
          ? null
          : Number(item.counted_quantity),
        difference: item.difference === null ? null : Number(item.difference),
        unitCostSnapshotCents: item.unit_cost_snapshot_cents === null
          ? null
          : Number(item.unit_cost_snapshot_cents),
        movementId: item.movement_id,
      })),
    }
  }

  async create(
    user: AuthenticatedUser,
    input: CreateStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount> {
    const route = "POST /api/v1/inventory/counts"
    const countId = await this.database.transaction().execute(async (transaction) => {
      const replayId = await replayedCountId(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
      )
      if (replayId) return replayId

      const products = await transaction
        .selectFrom("products as product")
        .innerJoin("inventory_balances as balance", (join) => join
          .onRef("balance.product_id", "=", "product.id")
          .onRef("balance.tenant_id", "=", "product.tenant_id"))
        .select(["product.id", "balance.on_hand"])
        .where("product.tenant_id", "=", user.tenantId)
        .where("product.id", "in", input.productIds)
        .where("product.active", "=", true)
        .where("product.archived_at", "is", null)
        .where("product.type", "!=", "service")
        .orderBy("product.id")
        .execute()

      if (products.length !== input.productIds.length) {
        throw new AppError(
          409,
          "INVALID_COUNT_PRODUCTS",
          "Every counted product must be active and stock-managed.",
        )
      }

      const count = await transaction.insertInto("stock_counts").values({
        tenant_id: user.tenantId,
        status: "draft",
        reason: input.reason,
        started_by: user.id,
        confirmed_by: null,
        confirmed_at: null,
        cancelled_by: null,
        cancelled_at: null,
        cancellation_reason: null,
      }).returning("id").executeTakeFirstOrThrow()

      await transaction.insertInto("stock_count_items").values(products.map((product) => ({
        tenant_id: user.tenantId,
        stock_count_id: count.id,
        product_id: product.id,
        expected_quantity: product.on_hand,
        counted_quantity: null,
        difference: null,
        unit_cost_snapshot_cents: null,
        movement_id: null,
      }))).execute()

      const payload = {
        countId: count.id,
        productIds: products.map((product) => product.id),
        reason: input.reason,
      }
      await insertCountEvent(
        transaction,
        user,
        count.id,
        "inventory.stock_count_created",
        input.reason,
        payload,
      )
      await saveIdempotency(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
        count.id,
        201,
      )
      return count.id
    })

    const count = await this.get(user.tenantId, countId)
    if (!count) throw new Error("Created stock count could not be reloaded")
    return count
  }

  async confirm(
    user: AuthenticatedUser,
    countId: string,
    input: ConfirmStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount> {
    const route = `POST /api/v1/inventory/counts/${countId}/confirm`
    const resultId = await this.database.transaction().execute(async (transaction) => {
      const replayId = await replayedCountId(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
      )
      if (replayId) return replayId

      const count = await transaction
        .selectFrom("stock_counts")
        .select(["id", "status", "version", "reason"])
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", countId)
        .forUpdate()
        .executeTakeFirst()

      if (!count) throw new AppError(404, "STOCK_COUNT_NOT_FOUND", "Stock count was not found.")
      if (count.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "The stock count changed. Reload and retry.")
      }
      if (count.status !== "draft") {
        throw new AppError(409, "STOCK_COUNT_NOT_DRAFT", "Only a draft count can be confirmed.")
      }

      const items = await transaction
        .selectFrom("stock_count_items as item")
        .innerJoin("products as product", "product.id", "item.product_id")
        .innerJoin("units as unit", "unit.id", "product.unit_id")
        .innerJoin("inventory_balances as balance", (join) => join
          .onRef("balance.product_id", "=", "item.product_id")
          .onRef("balance.tenant_id", "=", "item.tenant_id"))
        .select([
          "item.id",
          "item.product_id",
          "item.expected_quantity",
          "product.current_cost_cents",
          "unit.quantity_scale",
          "balance.on_hand",
          "balance.reserved",
          "balance.average_unit_cost_cents",
        ])
        .where("item.tenant_id", "=", user.tenantId)
        .where("item.stock_count_id", "=", countId)
        .orderBy("item.product_id")
        .forUpdate()
        .execute()

      const submitted = new Map(input.items.map((item) => [item.productId, item]))
      if (submitted.size !== input.items.length || submitted.size !== items.length) {
        throw new AppError(
          400,
          "INVALID_COUNT_ITEMS",
          "Every count item must be submitted exactly once.",
        )
      }

      const occurredAt = new Date()
      const movements: string[] = []
      for (const item of items) {
        const submittedItem = submitted.get(item.product_id)
        if (!submittedItem) {
          throw new AppError(
            400,
            "INVALID_COUNT_ITEMS",
            "Every count item must be submitted exactly once.",
          )
        }

        const scaleFactor = 10 ** item.quantity_scale
        if (
          Math.abs(
            Math.round(submittedItem.countedQuantity * scaleFactor)
            - (submittedItem.countedQuantity * scaleFactor),
          ) >= 1e-8
        ) {
          throw new AppError(
            400,
            "INVALID_QUANTITY_SCALE",
            `Counted quantity for product ${item.product_id} exceeds its unit precision.`,
          )
        }

        const expected = Number(item.expected_quantity)
        const currentOnHand = Number(item.on_hand)
        const reserved = Number(item.reserved)
        if (currentOnHand !== expected) {
          throw new AppError(
            409,
            "STOCK_CHANGED_DURING_COUNT",
            "Stock changed after the count started. Create a new count.",
            { productId: item.product_id },
          )
        }
        if (submittedItem.countedQuantity < reserved) {
          throw new AppError(
            409,
            "COUNT_BELOW_RESERVED",
            "Counted quantity cannot be below the reserved quantity.",
            { productId: item.product_id, reserved },
          )
        }

        const difference = submittedItem.countedQuantity - expected
        if (difference <= 0 && submittedItem.unitCostCents !== undefined) {
          throw new AppError(
            400,
            "COUNT_UNIT_COST_NOT_ALLOWED",
            "Unit cost is accepted only when a stock count adds quantity.",
            { productId: item.product_id },
          )
        }
        const oldAverageCost = item.average_unit_cost_cents === null
          ? null
          : Number(item.average_unit_cost_cents)
        const acceptedCost = difference > 0
          ? submittedItem.unitCostCents
            ?? oldAverageCost
            ?? item.current_cost_cents
          : oldAverageCost

        if (difference > 0 && acceptedCost === null) {
          throw new AppError(
            400,
            "COUNT_UNIT_COST_REQUIRED",
            "A unit cost is required when a count adds stock without a known cost.",
            { productId: item.product_id },
          )
        }

        let movementId: string | null = null
        let nextAverageCost = oldAverageCost
        if (difference !== 0) {
          if (difference > 0 && acceptedCost !== null) {
            nextAverageCost = expected > 0 && oldAverageCost !== null
              ? ((expected * oldAverageCost) + (difference * acceptedCost))
                / submittedItem.countedQuantity
              : acceptedCost
            nextAverageCost = Math.round(nextAverageCost * 1_000_000) / 1_000_000
          }

          await transaction.updateTable("inventory_balances").set({
            on_hand: submittedItem.countedQuantity,
            average_unit_cost_cents: nextAverageCost,
            version: sql`version + 1`,
            updated_at: occurredAt,
          })
            .where("tenant_id", "=", user.tenantId)
            .where("product_id", "=", item.product_id)
            .execute()

          const movement = await transaction.insertInto("stock_movements").values({
            tenant_id: user.tenantId,
            product_id: item.product_id,
            movement_type: "stock_count_adjustment",
            quantity: difference,
            resulting_on_hand: submittedItem.countedQuantity,
            resulting_reserved: reserved,
            unit_cost_snapshot_cents: acceptedCost,
            source_type: "stock_count",
            source_id: countId,
            source_reference: null,
            reason: count.reason,
            actor_user_id: user.id,
            occurred_at: occurredAt,
            reversal_of_id: null,
          }).returning("id").executeTakeFirstOrThrow()
          movementId = movement.id
          movements.push(movement.id)

          await recordInventoryTracking(transaction, {
            tenantId: user.tenantId,
            productId: item.product_id,
            movementId,
            movementType: "stock_count_adjustment",
            quantity: difference,
            oldOnHand: expected,
            newOnHand: submittedItem.countedQuantity,
            reserved,
            occurredAt,
          })

          const nextRoundedCost = nextAverageCost === null
            ? null
            : Math.round(nextAverageCost)
          if (
            nextRoundedCost !== null
            && nextRoundedCost !== item.current_cost_cents
          ) {
            await transaction.updateTable("products").set({
              current_cost_cents: nextRoundedCost,
              cost_source: "moving_average",
              updated_by: user.id,
              updated_at: occurredAt,
              version: sql`version + 1`,
            })
              .where("tenant_id", "=", user.tenantId)
              .where("id", "=", item.product_id)
              .execute()

            await transaction.insertInto("product_cost_history").values({
              tenant_id: user.tenantId,
              product_id: item.product_id,
              old_cost_cents: item.current_cost_cents,
              new_cost_cents: nextRoundedCost,
              source: "moving_average",
              actor_id: user.id,
              reason: count.reason,
            }).execute()
          }
        }

        await transaction.updateTable("stock_count_items").set({
          counted_quantity: submittedItem.countedQuantity,
          difference,
          unit_cost_snapshot_cents: acceptedCost,
          movement_id: movementId,
          updated_at: occurredAt,
        })
          .where("tenant_id", "=", user.tenantId)
          .where("id", "=", item.id)
          .execute()
      }

      await transaction.updateTable("stock_counts").set({
        status: "confirmed",
        confirmed_by: user.id,
        confirmed_at: occurredAt,
        version: sql`version + 1`,
        updated_at: occurredAt,
      })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", countId)
        .execute()

      const payload = {
        countId,
        movementIds: movements,
        itemCount: items.length,
      }
      await insertCountEvent(
        transaction,
        user,
        countId,
        "inventory.stock_count_confirmed",
        count.reason,
        payload,
      )
      await saveIdempotency(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
        countId,
        200,
      )
      return countId
    })

    const count = await this.get(user.tenantId, resultId)
    if (!count) throw new Error("Confirmed stock count could not be reloaded")
    return count
  }

  async cancel(
    user: AuthenticatedUser,
    countId: string,
    input: CancelStockCountInput,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<StockCount> {
    const route = `POST /api/v1/inventory/counts/${countId}/cancel`
    const resultId = await this.database.transaction().execute(async (transaction) => {
      const replayId = await replayedCountId(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
      )
      if (replayId) return replayId

      const count = await transaction
        .selectFrom("stock_counts")
        .select(["id", "status", "version"])
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", countId)
        .forUpdate()
        .executeTakeFirst()

      if (!count) throw new AppError(404, "STOCK_COUNT_NOT_FOUND", "Stock count was not found.")
      if (count.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "The stock count changed. Reload and retry.")
      }
      if (count.status !== "draft") {
        throw new AppError(409, "STOCK_COUNT_NOT_DRAFT", "Only a draft count can be cancelled.")
      }

      const cancelledAt = new Date()
      await transaction.updateTable("stock_counts").set({
        status: "cancelled",
        cancelled_by: user.id,
        cancelled_at: cancelledAt,
        cancellation_reason: input.reason,
        version: sql`version + 1`,
        updated_at: cancelledAt,
      })
        .where("tenant_id", "=", user.tenantId)
        .where("id", "=", countId)
        .execute()

      const payload = { countId, reason: input.reason }
      await insertCountEvent(
        transaction,
        user,
        countId,
        "inventory.stock_count_cancelled",
        input.reason,
        payload,
      )
      await saveIdempotency(
        transaction,
        user,
        route,
        idempotencyKey,
        requestHash,
        countId,
        200,
      )
      return countId
    })

    const count = await this.get(user.tenantId, resultId)
    if (!count) throw new Error("Cancelled stock count could not be reloaded")
    return count
  }
}
