import { sql, type Kysely } from "kysely"
import type { Database, ServiceOrderStatus } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import { nextTenantSequence } from "../../shared/persistence/tenant-sequence.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  CreateServiceOrderInput,
  ServiceOrder,
  ServiceOrderColumn,
  UpdateServiceOrderInput,
} from "./types.js"

export interface ColumnWrite {
  label: string
  semanticType: "open" | "cancelled"
  colorToken: string
  displayPosition: number
}

export interface ColumnOrder {
  id: string
  version: number
}

export interface ServiceOrderRepository {
  listColumns(user: AuthenticatedUser): Promise<ServiceOrderColumn[]>
  createColumn(
    user: AuthenticatedUser,
    values: ColumnWrite,
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn>
  updateColumn(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: Omit<ColumnWrite, "semanticType">,
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn | null>
  reorderColumns(
    user: AuthenticatedUser,
    columns: ColumnOrder[],
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn[]>
  archiveColumn(
    user: AuthenticatedUser,
    id: string,
    version: number,
    reason: string,
    key: string,
    hash: string,
  ): Promise<boolean>
  list(user: AuthenticatedUser, history: boolean): Promise<ServiceOrder[]>
  get(tenantId: string, id: string): Promise<ServiceOrder | null>
  create(
    user: AuthenticatedUser,
    input: CreateServiceOrderInput,
    key: string,
    hash: string,
  ): Promise<ServiceOrder>
  update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateServiceOrderInput,
    key: string,
    hash: string,
  ): Promise<ServiceOrder | null>
  transition(
    user: AuthenticatedUser,
    id: string,
    input: { version: number; columnId: string; reason: string },
    key: string,
    hash: string,
  ): Promise<ServiceOrder>
}

const defaults = [
  { label: "Pendente", semanticType: "open", colorToken: "--color-warning", position: 0 },
  { label: "Em Andamento", semanticType: "open", colorToken: "--color-accent", position: 1 },
  { label: "Aguardando Peças", semanticType: "open", colorToken: "--color-info", position: 2 },
  { label: "Concluído", semanticType: "completed", colorToken: "--color-success", position: 3 },
  { label: "Cancelado", semanticType: "cancelled", colorToken: "--color-danger", position: 4 },
] as const

async function ensureDefaultColumns(
  database: Kysely<Database>,
  user: AuthenticatedUser,
): Promise<void> {
  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${user.tenantId}:service-columns`}, 0))
  `.execute(database)
  const existing = await database.selectFrom("service_order_columns")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("tenant_id", "=", user.tenantId).where("archived_at", "is", null)
    .executeTakeFirstOrThrow()
  if (Number(existing.count) > 0) return
  await database.insertInto("service_order_columns").values(defaults.map((column) => ({
    tenant_id: user.tenantId,
    label: column.label,
    semantic_type: column.semanticType,
    color_token: column.colorToken,
    display_position: column.position,
    protected: column.semanticType === "completed",
    created_by: user.id,
    updated_by: user.id,
    archived_at: null,
  }))).execute()
}

function mapColumn(row: {
  id: string
  label: string
  semantic_type: ServiceOrderStatus
  color_token: string
  display_position: number
  protected: boolean
  version: number
}): ServiceOrderColumn {
  return {
    id: row.id,
    label: row.label,
    semanticType: row.semantic_type,
    colorToken: row.color_token,
    displayPosition: row.display_position,
    protected: row.protected,
    version: row.version,
  }
}

function columnSelection() {
  return [
    "id", "label", "semantic_type", "color_token", "display_position",
    "protected", "version",
  ] as const
}

export class KyselyServiceOrderRepository implements ServiceOrderRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listColumns(user: AuthenticatedUser): Promise<ServiceOrderColumn[]> {
    await this.database.transaction().execute(async (transaction) => {
      await ensureDefaultColumns(transaction, user)
    })
    const rows = await this.database.selectFrom("service_order_columns")
      .select(columnSelection()).where("tenant_id", "=", user.tenantId)
      .where("archived_at", "is", null).orderBy("display_position").orderBy("id").execute()
    return rows.map(mapColumn)
  }

  private async getColumn(
    tenantId: string,
    id: string,
  ): Promise<ServiceOrderColumn | null> {
    const row = await this.database.selectFrom("service_order_columns")
      .select(columnSelection()).where("tenant_id", "=", tenantId).where("id", "=", id)
      .where("archived_at", "is", null).executeTakeFirst()
    return row ? mapColumn(row) : null
  }

  async createColumn(
    user: AuthenticatedUser,
    values: ColumnWrite,
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn> {
    const route = "POST /api/v1/service-order-columns"
    const id = await this.database.transaction().execute(async (transaction) => {
      await ensureDefaultColumns(transaction, user)
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("service_order_columns").values({
        tenant_id: user.tenantId,
        label: values.label,
        semantic_type: values.semanticType,
        color_token: values.colorToken,
        display_position: values.displayPosition,
        protected: false,
        created_by: user.id,
        updated_by: user.id,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "service_order_column.created",
        entityType: "service_order_column",
        entityId: row.id,
        after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const column = await this.getColumn(user.tenantId, id)
    if (!column) throw new Error("Created service-order column could not be reloaded")
    return column
  }

  async updateColumn(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: Omit<ColumnWrite, "semanticType">,
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn | null> {
    const route = `PATCH /api/v1/service-order-columns/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.updateTable("service_order_columns").set({
        label: values.label,
        color_token: values.colorToken,
        display_position: values.displayPosition,
        updated_by: user.id,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "service_order_column.updated",
        entityType: "service_order_column",
        entityId: id,
        after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getColumn(user.tenantId, result) : null
  }

  async reorderColumns(
    user: AuthenticatedUser,
    columns: ColumnOrder[],
    key: string,
    hash: string,
  ): Promise<ServiceOrderColumn[]> {
    const route = "POST /api/v1/service-order-columns/reorder"
    const firstColumnId = columns[0]?.id
    if (!firstColumnId) {
      throw new AppError(400, "INVALID_COLUMN_ORDER", "Column order cannot be empty.")
    }
    await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return

      const current = await transaction.selectFrom("service_order_columns")
        .select(columnSelection()).where("tenant_id", "=", user.tenantId)
        .where("archived_at", "is", null).orderBy("display_position").orderBy("id")
        .forUpdate().execute()
      const requested = new Map(columns.map((column) => [column.id, column.version]))
      if (
        requested.size !== columns.length
        || current.length !== columns.length
        || current.some((column) => requested.get(column.id) !== column.version)
      ) {
        throw new AppError(
          409,
          "COLUMN_REORDER_CONFLICT",
          "The columns changed. Reload the board and try again.",
        )
      }

      const temporaryOffset = Math.max(...current.map((column) => column.display_position))
        + current.length + 1
      const updatedAt = new Date()
      await transaction.updateTable("service_order_columns").set({
        display_position: sql`display_position + ${temporaryOffset}`,
      }).where("tenant_id", "=", user.tenantId).where("archived_at", "is", null).execute()

      for (const [displayPosition, column] of columns.entries()) {
        await transaction.updateTable("service_order_columns").set({
          display_position: displayPosition,
          updated_by: user.id,
          updated_at: updatedAt,
          version: sql`version + 1`,
        }).where("tenant_id", "=", user.tenantId).where("id", "=", column.id).execute()
      }

      await recordDomainEvent(transaction, user, {
        action: "service_order_columns.reordered",
        entityType: "service_order_columns",
        entityId: firstColumnId,
        after: { columnIds: columns.map((column) => column.id) },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, firstColumnId, 200)
    })
    return this.listColumns(user)
  }

  async archiveColumn(
    user: AuthenticatedUser,
    id: string,
    version: number,
    reason: string,
    key: string,
    hash: string,
  ): Promise<boolean> {
    const route = `POST /api/v1/service-order-columns/${id}/archive`
    return this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return true
      const column = await transaction.selectFrom("service_order_columns").select([
        "id", "semantic_type", "protected", "version",
      ]).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("archived_at", "is", null).forUpdate().executeTakeFirst()
      if (!column) return false
      if (column.version !== version) {
        throw new AppError(409, "STALE_VERSION", "Column changed. Reload and retry.")
      }
      if (column.protected) {
        throw new AppError(409, "PROTECTED_COLUMN", "The completed column cannot be archived.")
      }
      const used = await transaction.selectFrom("service_orders")
        .select("id").where("tenant_id", "=", user.tenantId)
        .where("current_column_id", "=", id).executeTakeFirst()
      if (used) {
        throw new AppError(409, "COLUMN_IN_USE", "Move all service orders before archiving.")
      }
      if (column.semantic_type === "open") {
        const open = await transaction.selectFrom("service_order_columns")
          .select((expression) => expression.fn.countAll<string>().as("count"))
          .where("tenant_id", "=", user.tenantId).where("semantic_type", "=", "open")
          .where("archived_at", "is", null).executeTakeFirstOrThrow()
        if (Number(open.count) <= 1) {
          throw new AppError(409, "LAST_OPEN_COLUMN", "At least one open column is required.")
        }
      }
      const archivedAt = new Date()
      await transaction.updateTable("service_order_columns").set({
        archived_at: archivedAt,
        updated_at: archivedAt,
        updated_by: user.id,
        version: sql`version + 1`,
      }).where("id", "=", id).execute()
      await recordDomainEvent(transaction, user, {
        action: "service_order_column.archived",
        entityType: "service_order_column",
        entityId: id,
        reason,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return true
    })
  }

  async list(user: AuthenticatedUser, history: boolean): Promise<ServiceOrder[]> {
    await this.listColumns(user)
    let query = this.database.selectFrom("service_orders as service_order")
      .select("service_order.id").where("service_order.tenant_id", "=", user.tenantId)
    if (!history) {
      query = query.innerJoin("tenant_settings as setting", "setting.tenant_id", "service_order.tenant_id")
        .where((expression) => expression.or([
          expression("service_order.current_status", "<>", "completed"),
          sql<boolean>`
            (service_order.completed_at AT TIME ZONE setting.timezone)::date
              >= (now() AT TIME ZONE setting.timezone)::date - 2
          `,
        ]))
    }
    const rows = await query.orderBy("service_order.created_at", "desc")
      .orderBy("service_order.id", "desc").execute()
    const orders = await Promise.all(rows.map(({ id }) => this.get(user.tenantId, id)))
    return orders.filter((order): order is ServiceOrder => order !== null)
  }

  async get(tenantId: string, id: string): Promise<ServiceOrder | null> {
    const row = await this.database.selectFrom("service_orders as service_order")
      .innerJoin("service_order_columns as column", "column.id", "service_order.current_column_id")
      .leftJoin("users as responsible", "responsible.id", "service_order.responsible_user_id")
      .select([
        "service_order.id", "service_order.business_number", "service_order.customer_id",
        "service_order.customer_name_snapshot", "service_order.title",
        "service_order.description", "service_order.priority", "service_order.due_at",
        "service_order.estimated_value_cents", "service_order.final_sale_id",
        "service_order.current_status", "service_order.completed_at",
        "service_order.cancelled_at", "service_order.version", "service_order.created_at",
        "service_order.updated_at", "responsible.id as responsible_id",
        "responsible.name as responsible_name", "column.id as column_id",
        "column.label as column_label", "column.semantic_type", "column.color_token",
        "column.display_position", "column.protected", "column.version as column_version",
      ]).where("service_order.tenant_id", "=", tenantId)
      .where("service_order.id", "=", id).executeTakeFirst()
    if (!row) return null
    const history = await this.database.selectFrom("service_order_status_history as history")
      .innerJoin("users as actor", "actor.id", "history.actor_user_id")
      .select([
        "history.id", "history.previous_column_id", "history.new_column_id",
        "history.previous_status", "history.new_status", "actor.id as actor_id",
        "actor.name as actor_name", "history.occurred_at", "history.reason",
        "history.metadata",
      ]).where("history.tenant_id", "=", tenantId)
      .where("history.service_order_id", "=", id)
      .orderBy("history.occurred_at").orderBy("history.id").execute()
    return {
      id: row.id,
      businessNumber: Number(row.business_number),
      customer: { id: row.customer_id, name: row.customer_name_snapshot },
      title: row.title,
      description: row.description,
      priority: row.priority,
      dueAt: row.due_at?.toISOString() ?? null,
      estimatedValueCents: Number(row.estimated_value_cents),
      finalSaleId: row.final_sale_id,
      column: {
        id: row.column_id,
        label: row.column_label,
        semanticType: row.semantic_type,
        colorToken: row.color_token,
        displayPosition: row.display_position,
        protected: row.protected,
        version: row.column_version,
      },
      status: row.current_status,
      responsible: row.responsible_id && row.responsible_name
        ? { id: row.responsible_id, name: row.responsible_name }
        : null,
      completedAt: row.completed_at?.toISOString() ?? null,
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      history: history.map((entry) => ({
        id: entry.id,
        previousColumnId: entry.previous_column_id,
        newColumnId: entry.new_column_id,
        previousStatus: entry.previous_status,
        newStatus: entry.new_status,
        actor: { id: entry.actor_id, name: entry.actor_name },
        occurredAt: entry.occurred_at.toISOString(),
        reason: entry.reason,
        metadata: entry.metadata,
      })),
    }
  }

  async create(
    user: AuthenticatedUser,
    input: CreateServiceOrderInput,
    key: string,
    hash: string,
  ): Promise<ServiceOrder> {
    const route = "POST /api/v1/service-orders"
    const id = await this.database.transaction().execute(async (transaction) => {
      await ensureDefaultColumns(transaction, user)
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const customer = await transaction.selectFrom("customers").select(["id", "name"])
        .where("tenant_id", "=", user.tenantId).where("id", "=", input.customerId)
        .where("status", "=", "active").where("archived_at", "is", null)
        .executeTakeFirst()
      if (!customer) throw new AppError(409, "CUSTOMER_UNAVAILABLE", "Customer is unavailable.")
      const column = input.columnId
        ? await transaction.selectFrom("service_order_columns").select(["id", "semantic_type"])
          .where("tenant_id", "=", user.tenantId).where("id", "=", input.columnId)
          .where("semantic_type", "=", "open").where("archived_at", "is", null)
          .executeTakeFirst()
        : await transaction.selectFrom("service_order_columns").select(["id", "semantic_type"])
          .where("tenant_id", "=", user.tenantId).where("semantic_type", "=", "open")
          .where("archived_at", "is", null).orderBy("display_position").executeTakeFirst()
      if (!column) throw new AppError(409, "OPEN_COLUMN_REQUIRED", "An open column is required.")
      await this.requireResponsible(transaction, user.tenantId, input.responsibleUserId ?? null)
      const businessNumber = await nextTenantSequence(
        transaction, user.tenantId, "service_order",
      )
      const created = await transaction.insertInto("service_orders").values({
        tenant_id: user.tenantId,
        business_number: businessNumber,
        customer_id: customer.id,
        customer_name_snapshot: customer.name,
        title: input.title,
        description: input.description ?? "",
        priority: input.priority,
        due_at: input.dueAt ? new Date(input.dueAt) : null,
        estimated_value_cents: input.estimatedValueCents,
        final_sale_id: null,
        current_column_id: column.id,
        current_status: "open",
        responsible_user_id: input.responsibleUserId ?? null,
        completed_at: null,
        cancelled_at: null,
        created_by: user.id,
        updated_by: user.id,
      }).returning(["id", "created_at"]).executeTakeFirstOrThrow()
      await transaction.insertInto("service_order_status_history").values({
        tenant_id: user.tenantId,
        service_order_id: created.id,
        previous_column_id: null,
        new_column_id: column.id,
        previous_status: null,
        new_status: "open",
        actor_user_id: user.id,
        occurred_at: created.created_at,
        reason: "Service order created.",
        metadata: null,
      }).execute()
      await recordDomainEvent(transaction, user, {
        action: "service_order.created", entityType: "service_order",
        entityId: created.id, after: { businessNumber, ...input },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, created.id, 201)
      return created.id
    })
    const order = await this.get(user.tenantId, id)
    if (!order) throw new Error("Created service order could not be reloaded")
    return order
  }

  private async requireResponsible(
    database: Kysely<Database>,
    tenantId: string,
    responsibleId: string | null,
  ): Promise<void> {
    if (!responsibleId) return
    const responsible = await database.selectFrom("users").select("id")
      .where("tenant_id", "=", tenantId).where("id", "=", responsibleId)
      .where("status", "=", "active").where("archived_at", "is", null)
      .executeTakeFirst()
    if (!responsible) {
      throw new AppError(409, "RESPONSIBLE_UNAVAILABLE", "Responsible employee is unavailable.")
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateServiceOrderInput,
    key: string,
    hash: string,
  ): Promise<ServiceOrder | null> {
    const route = `PATCH /api/v1/service-orders/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const current = await transaction.selectFrom("service_orders").selectAll()
        .where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .forUpdate().executeTakeFirst()
      if (!current) return null
      if (current.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "Service order changed. Reload and retry.")
      }
      if (current.current_status !== "open") {
        throw new AppError(409, "TERMINAL_SERVICE_ORDER", "A completed order cannot be edited.")
      }
      const customerId = input.customerId ?? current.customer_id
      const customer = await transaction.selectFrom("customers").select(["id", "name"])
        .where("tenant_id", "=", user.tenantId).where("id", "=", customerId)
        .where("status", "=", "active").where("archived_at", "is", null)
        .executeTakeFirst()
      if (!customer) throw new AppError(409, "CUSTOMER_UNAVAILABLE", "Customer is unavailable.")
      const responsibleId = input.responsibleUserId === undefined
        ? current.responsible_user_id : input.responsibleUserId
      await this.requireResponsible(transaction, user.tenantId, responsibleId)
      const updated = await transaction.updateTable("service_orders").set({
        customer_id: customer.id,
        customer_name_snapshot: customer.name,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        priority: input.priority ?? current.priority,
        due_at: input.dueAt === undefined
          ? current.due_at : input.dueAt ? new Date(input.dueAt) : null,
        estimated_value_cents: input.estimatedValueCents ?? current.estimated_value_cents,
        responsible_user_id: responsibleId,
        updated_by: user.id,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("id", "=", id).where("version", "=", input.version)
        .returning("id").executeTakeFirst()
      if (!updated) return null
      await recordDomainEvent(transaction, user, {
        action: "service_order.updated", entityType: "service_order",
        entityId: id, before: current, after: input,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.get(user.tenantId, result) : null
  }

  async transition(
    user: AuthenticatedUser,
    id: string,
    input: { version: number; columnId: string; reason: string },
    key: string,
    hash: string,
  ): Promise<ServiceOrder> {
    const route = `POST /api/v1/service-orders/${id}/transitions`
    const resultId = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const current = await transaction.selectFrom("service_orders").select([
        "id", "current_column_id", "current_status", "version", "final_sale_id",
      ]).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .forUpdate().executeTakeFirst()
      if (!current) throw new AppError(404, "SERVICE_ORDER_NOT_FOUND", "Service order was not found.")
      if (current.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "Service order changed. Reload and retry.")
      }
      if (current.current_status !== "open") {
        throw new AppError(409, "TERMINAL_SERVICE_ORDER", "Terminal service orders cannot transition.")
      }
      if (current.current_column_id === input.columnId) {
        throw new AppError(409, "SAME_SERVICE_ORDER_COLUMN", "Service order is already in this column.")
      }
      const target = await transaction.selectFrom("service_order_columns")
        .select(["id", "semantic_type"]).where("tenant_id", "=", user.tenantId)
        .where("id", "=", input.columnId).where("archived_at", "is", null)
        .executeTakeFirst()
      if (!target) throw new AppError(404, "COLUMN_NOT_FOUND", "Column was not found.")
      if (target.semantic_type === "completed" && current.final_sale_id) {
        throw new AppError(409, "SERVICE_ORDER_ALREADY_BILLED", "Service order is already billed.")
      }
      const occurredAt = new Date()
      await transaction.updateTable("service_orders").set({
        current_column_id: target.id,
        current_status: target.semantic_type,
        completed_at: target.semantic_type === "completed" ? occurredAt : null,
        cancelled_at: target.semantic_type === "cancelled" ? occurredAt : null,
        updated_by: user.id,
        updated_at: occurredAt,
        version: sql`version + 1`,
      }).where("id", "=", id).execute()
      await transaction.insertInto("service_order_status_history").values({
        tenant_id: user.tenantId,
        service_order_id: id,
        previous_column_id: current.current_column_id,
        new_column_id: target.id,
        previous_status: current.current_status,
        new_status: target.semantic_type,
        actor_user_id: user.id,
        occurred_at: occurredAt,
        reason: input.reason,
        metadata: null,
      }).execute()
      await recordDomainEvent(transaction, user, {
        action: "service_order.status_changed", entityType: "service_order",
        entityId: id, reason: input.reason,
        before: { columnId: current.current_column_id, status: current.current_status },
        after: { columnId: target.id, status: target.semantic_type },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    const order = await this.get(user.tenantId, resultId)
    if (!order) throw new Error("Transitioned service order could not be reloaded")
    return order
  }
}
