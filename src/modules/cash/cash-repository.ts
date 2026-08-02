import { sql, type Kysely } from "kysely"
import type { Database, PaymentMethod } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  CashAssignment,
  CashRegister,
  CashSession,
} from "./types.js"

export interface CashRepository {
  listRegisters(tenantId: string): Promise<CashRegister[]>
  getRegister(tenantId: string, id: string): Promise<CashRegister | null>
  createRegister(
    user: AuthenticatedUser,
    values: { code: string; name: string },
    key: string,
    hash: string,
  ): Promise<CashRegister>
  updateRegister(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: { code: string; name: string; active: boolean },
    key: string,
    hash: string,
  ): Promise<CashRegister | null>
  listAssignments(tenantId: string, currentOnly: boolean): Promise<CashAssignment[]>
  assign(
    user: AuthenticatedUser,
    input: { userId: string; registerId: string; reason: string },
    key: string,
    hash: string,
  ): Promise<CashAssignment>
  getCurrentAssignment(tenantId: string, userId: string): Promise<CashAssignment | null>
  getMyRegister(user: AuthenticatedUser): Promise<{
    assignment: CashAssignment
    session: CashSession | null
  } | null>
  getCurrentSession(tenantId: string, userId: string): Promise<CashSession | null>
  getSession(tenantId: string, id: string): Promise<CashSession | null>
  openSession(
    user: AuthenticatedUser,
    openingAmountCents: number,
    key: string,
    hash: string,
  ): Promise<CashSession>
  manualMovement(
    user: AuthenticatedUser,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
    hash: string,
  ): Promise<CashSession>
  adminMovement(
    user: AuthenticatedUser,
    sessionId: string,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
    hash: string,
  ): Promise<CashSession>
  closeSession(
    user: AuthenticatedUser,
    input: {
      version: number
      countedByMethod: Record<PaymentMethod, number>
      note: string | null
    },
    key: string,
    hash: string,
  ): Promise<CashSession>
  listSessions(tenantId: string, page: number, pageSize: number): Promise<{
    data: CashSession[]
    page: number
    pageSize: number
    total: number
  }>
}

function mapRegister(row: {
  id: string
  code: string
  name: string
  active: boolean
  version: number
  created_at: Date
  updated_at: Date
}): CashRegister {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function registerSelection() {
  return ["id", "code", "name", "active", "version", "created_at", "updated_at"] as const
}

export class KyselyCashRepository implements CashRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listRegisters(tenantId: string): Promise<CashRegister[]> {
    const rows = await this.database.selectFrom("cash_registers").select(registerSelection())
      .where("tenant_id", "=", tenantId).where("archived_at", "is", null)
      .orderBy("name").orderBy("id").execute()
    return rows.map(mapRegister)
  }

  async getRegister(tenantId: string, id: string): Promise<CashRegister | null> {
    const row = await this.database.selectFrom("cash_registers").select(registerSelection())
      .where("tenant_id", "=", tenantId).where("id", "=", id)
      .where("archived_at", "is", null).executeTakeFirst()
    return row ? mapRegister(row) : null
  }

  async createRegister(
    user: AuthenticatedUser,
    values: { code: string; name: string },
    key: string,
    hash: string,
  ): Promise<CashRegister> {
    const route = "POST /api/v1/cash-registers"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("cash_registers").values({
        tenant_id: user.tenantId,
        code: values.code,
        name: values.name,
        active: true,
        created_by: user.id,
        updated_by: user.id,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "cash_register.created", entityType: "cash_register",
        entityId: row.id, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const register = await this.getRegister(user.tenantId, id)
    if (!register) throw new Error("Created cash register could not be reloaded")
    return register
  }

  async updateRegister(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: { code: string; name: string; active: boolean },
    key: string,
    hash: string,
  ): Promise<CashRegister | null> {
    const route = `PATCH /api/v1/cash-registers/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      if (!values.active) {
        const open = await transaction.selectFrom("cash_sessions").select("id")
          .where("tenant_id", "=", user.tenantId).where("cash_register_id", "=", id)
          .where("status", "=", "open").executeTakeFirst()
        if (open) {
          throw new AppError(
            409,
            "OPEN_CASH_SESSION_BLOCKS_DEACTIVATION",
            "Close the register session before deactivating it.",
          )
        }
      }
      const row = await transaction.updateTable("cash_registers").set({
        code: values.code,
        name: values.name,
        active: values.active,
        updated_by: user.id,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "cash_register.updated", entityType: "cash_register",
        entityId: id, after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getRegister(user.tenantId, result) : null
  }

  async listAssignments(tenantId: string, currentOnly: boolean): Promise<CashAssignment[]> {
    let query = this.database.selectFrom("cash_register_assignments as assignment")
      .innerJoin("users as employee", "employee.id", "assignment.user_id")
      .innerJoin("cash_registers as register", "register.id", "assignment.cash_register_id")
      .select([
        "assignment.id", "employee.id as user_id", "employee.name as user_name",
        "register.id as register_id", "register.code", "register.name as register_name",
        "assignment.valid_from", "assignment.valid_until", "assignment.reason",
      ]).where("assignment.tenant_id", "=", tenantId)
    if (currentOnly) query = query.where("assignment.valid_until", "is", null)
    const rows = await query.orderBy("assignment.valid_from", "desc").orderBy("assignment.id", "desc")
      .execute()
    return rows.map((row) => ({
      id: row.id,
      user: { id: row.user_id, name: row.user_name },
      register: { id: row.register_id, code: row.code, name: row.register_name },
      validFrom: row.valid_from.toISOString(),
      validUntil: row.valid_until?.toISOString() ?? null,
      reason: row.reason,
    }))
  }

  async getCurrentAssignment(tenantId: string, userId: string): Promise<CashAssignment | null> {
    const assignments = await this.listAssignments(tenantId, true)
    return assignments.find((assignment) => assignment.user.id === userId) ?? null
  }

  async getMyRegister(user: AuthenticatedUser): Promise<{
    assignment: CashAssignment
    session: CashSession | null
  } | null> {
    const assignment = await this.getCurrentAssignment(user.tenantId, user.id)
    if (!assignment) return null
    return {
      assignment,
      session: await this.getCurrentSession(user.tenantId, user.id),
    }
  }

  async assign(
    user: AuthenticatedUser,
    input: { userId: string; registerId: string; reason: string },
    key: string,
    hash: string,
  ): Promise<CashAssignment> {
    const route = "POST /api/v1/cash-register-assignments"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const [employee, register] = await Promise.all([
        transaction.selectFrom("users").select("id")
          .where("tenant_id", "=", user.tenantId).where("id", "=", input.userId)
          .where("status", "=", "active").where("archived_at", "is", null).executeTakeFirst(),
        transaction.selectFrom("cash_registers").select("id")
          .where("tenant_id", "=", user.tenantId).where("id", "=", input.registerId)
          .where("active", "=", true).where("archived_at", "is", null).executeTakeFirst(),
      ])
      if (!employee || !register) {
        throw new AppError(409, "INVALID_CASH_ASSIGNMENT", "Employee or register is unavailable.")
      }
      const current = await transaction.selectFrom("cash_register_assignments")
        .select(["id", "user_id", "cash_register_id"])
        .where("tenant_id", "=", user.tenantId)
        .where((expression) => expression.or([
          expression("user_id", "=", input.userId),
          expression("cash_register_id", "=", input.registerId),
        ])).where("valid_until", "is", null).forUpdate().execute()
      if (current.some((assignment) =>
        assignment.user_id === input.userId
        && assignment.cash_register_id === input.registerId
      )) {
        throw new AppError(
          409,
          "CASH_ASSIGNMENT_UNCHANGED",
          "Employee is already assigned to this register.",
        )
      }
      const openSession = await transaction.selectFrom("cash_sessions")
        .select("id").where("tenant_id", "=", user.tenantId)
        .where("status", "=", "open")
        .where((expression) => expression.or([
          expression("opening_operator_id", "=", input.userId),
          expression("cash_register_id", "=", input.registerId),
        ])).executeTakeFirst()
      if (openSession) {
        throw new AppError(
          409,
          "OPEN_CASH_SESSION_BLOCKS_ASSIGNMENT",
          "Close the affected cash session before changing the assignment.",
        )
      }
      const now = new Date()
      await transaction.updateTable("cash_register_assignments").set({ valid_until: now })
        .where("tenant_id", "=", user.tenantId)
        .where((expression) => expression.or([
          expression("user_id", "=", input.userId),
          expression("cash_register_id", "=", input.registerId),
        ])).where("valid_until", "is", null).execute()
      const row = await transaction.insertInto("cash_register_assignments").values({
        tenant_id: user.tenantId,
        user_id: input.userId,
        cash_register_id: input.registerId,
        valid_from: now,
        valid_until: null,
        assigned_by: user.id,
        reason: input.reason,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "cash_register.assigned", entityType: "cash_register_assignment",
        entityId: row.id, reason: input.reason, after: input,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const assignment = (await this.listAssignments(user.tenantId, false))
      .find((item) => item.id === id)
    if (!assignment) throw new Error("Created cash assignment could not be reloaded")
    return assignment
  }

  async getCurrentSession(tenantId: string, userId: string): Promise<CashSession | null> {
    const row = await this.database.selectFrom("cash_sessions").select("id")
      .where("tenant_id", "=", tenantId).where("opening_operator_id", "=", userId)
      .where("status", "=", "open").executeTakeFirst()
    return row ? this.getSession(tenantId, row.id) : null
  }

  async getSession(tenantId: string, id: string): Promise<CashSession | null> {
    const row = await this.database.selectFrom("cash_sessions as session")
      .innerJoin("cash_registers as register", "register.id", "session.cash_register_id")
      .innerJoin("users as opener", "opener.id", "session.opening_operator_id")
      .leftJoin("users as closer", "closer.id", "session.closing_operator_id")
      .select([
        "session.id", "register.id as register_id", "register.code",
        "register.name as register_name", "opener.id as opener_id", "opener.name as opener_name",
        "session.opened_at", "session.opening_amount_cents", "session.status",
        "closer.id as closer_id", "closer.name as closer_name", "session.closed_at",
        "session.closing_note", "session.version",
      ]).where("session.tenant_id", "=", tenantId).where("session.id", "=", id)
      .executeTakeFirst()
    if (!row) return null
    const [movements, closeCounts] = await Promise.all([
      this.database.selectFrom("cash_movements as movement")
        .innerJoin("users as actor", "actor.id", "movement.actor_user_id")
        .select([
          "movement.id", "movement.movement_type", "movement.payment_method",
          "movement.amount_cents", "movement.reason", "actor.id as actor_id",
          "actor.name as actor_name", "movement.occurred_at", "movement.source_type",
          "movement.source_id",
        ]).where("movement.tenant_id", "=", tenantId)
        .where("movement.cash_session_id", "=", id)
        .orderBy("movement.occurred_at", "desc").orderBy("movement.id", "desc").execute(),
      this.database.selectFrom("cash_close_counts").select([
        "payment_method", "expected_amount_cents", "counted_amount_cents", "difference_cents",
      ]).where("tenant_id", "=", tenantId).where("cash_session_id", "=", id)
        .orderBy("payment_method").execute(),
    ])
    const expectedByMethod: Record<PaymentMethod, number> = {
      cash: 0, credit: 0, debit: 0, pix: 0,
    }
    for (const movement of movements) {
      expectedByMethod[movement.payment_method] += Number(movement.amount_cents)
    }
    return {
      id: row.id,
      register: { id: row.register_id, code: row.code, name: row.register_name },
      openingOperator: { id: row.opener_id, name: row.opener_name },
      openedAt: row.opened_at.toISOString(),
      openingAmountCents: Number(row.opening_amount_cents),
      status: row.status,
      closingOperator: row.closer_id && row.closer_name
        ? { id: row.closer_id, name: row.closer_name } : null,
      closedAt: row.closed_at?.toISOString() ?? null,
      closingNote: row.closing_note,
      version: row.version,
      expectedByMethod,
      closeCounts: closeCounts.map((count) => ({
        paymentMethod: count.payment_method,
        expectedAmountCents: Number(count.expected_amount_cents),
        countedAmountCents: Number(count.counted_amount_cents),
        differenceCents: Number(count.difference_cents),
      })),
      movements: movements.map((movement) => ({
        id: movement.id,
        type: movement.movement_type,
        paymentMethod: movement.payment_method,
        amountCents: Number(movement.amount_cents),
        reason: movement.reason,
        actor: { id: movement.actor_id, name: movement.actor_name },
        occurredAt: movement.occurred_at.toISOString(),
        sourceType: movement.source_type,
        sourceId: movement.source_id,
      })),
    }
  }

  async openSession(
    user: AuthenticatedUser,
    openingAmountCents: number,
    key: string,
    hash: string,
  ): Promise<CashSession> {
    const route = "POST /api/v1/cash-registers/me/open"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      let assignment = await transaction.selectFrom("cash_register_assignments as assignment")
        .innerJoin("cash_registers as register", "register.id", "assignment.cash_register_id")
        .select(["register.id"]).where("assignment.tenant_id", "=", user.tenantId)
        .where("assignment.user_id", "=", user.id).where("assignment.valid_until", "is", null)
        .where("register.active", "=", true).where("register.archived_at", "is", null)
        .forUpdate(["assignment", "register"]).executeTakeFirst()
      if (!assignment) {
        let register = await transaction.selectFrom("cash_registers as register")
          .leftJoin("cash_register_assignments as current_assignment", (join) => join
            .onRef("current_assignment.cash_register_id", "=", "register.id")
            .on("current_assignment.valid_until", "is", null))
          .select("register.id")
          .where("register.tenant_id", "=", user.tenantId)
          .where("register.active", "=", true)
          .where("register.archived_at", "is", null)
          .where("current_assignment.id", "is", null)
          .orderBy("register.created_at")
          .forUpdate("register")
          .executeTakeFirst()
        if (!register) {
          register = await transaction.insertInto("cash_registers").values({
            tenant_id: user.tenantId,
            code: `auto-${user.id}`,
            name: `Caixa de ${user.name}`,
            active: true,
            created_by: user.id,
            updated_by: user.id,
            archived_at: null,
          }).returning("id").executeTakeFirstOrThrow()
          await recordDomainEvent(transaction, user, {
            action: "cash_register.created",
            entityType: "cash_register",
            entityId: register.id,
            reason: "Automatic setup on first opening.",
            after: { code: `auto-${user.id}`, name: `Caixa de ${user.name}` },
          })
        }
        const assigned = await transaction.insertInto("cash_register_assignments").values({
          tenant_id: user.tenantId,
          user_id: user.id,
          cash_register_id: register.id,
          valid_until: null,
          assigned_by: user.id,
          reason: "Automatic assignment on first opening.",
        }).returning("id").executeTakeFirstOrThrow()
        await recordDomainEvent(transaction, user, {
          action: "cash_register.assigned",
          entityType: "cash_register_assignment",
          entityId: assigned.id,
          reason: "Automatic assignment on first opening.",
          after: { userId: user.id, registerId: register.id },
        })
        assignment = register
      }
      const session = await transaction.insertInto("cash_sessions").values({
        tenant_id: user.tenantId,
        cash_register_id: assignment.id,
        opening_operator_id: user.id,
        opening_amount_cents: openingAmountCents,
        status: "open",
        closing_operator_id: null,
        closed_at: null,
        closing_note: null,
      }).returning(["id", "opened_at"]).executeTakeFirstOrThrow()
      if (openingAmountCents > 0) {
        await transaction.insertInto("cash_movements").values({
          tenant_id: user.tenantId,
          cash_session_id: session.id,
          movement_type: "opening",
          payment_method: "cash",
          amount_cents: openingAmountCents,
          source_type: "cash_session",
          source_id: session.id,
          actor_user_id: user.id,
          reason: "Cash session opening.",
          occurred_at: session.opened_at,
          reversal_of_id: null,
        }).execute()
      }
      await recordDomainEvent(transaction, user, {
        action: "cash_session.opened", entityType: "cash_session",
        entityId: session.id, after: { openingAmountCents },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, session.id, 201)
      return session.id
    })
    const session = await this.getSession(user.tenantId, id)
    if (!session) throw new Error("Opened cash session could not be reloaded")
    return session
  }

  async manualMovement(
    user: AuthenticatedUser,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
    hash: string,
  ): Promise<CashSession> {
    const route = `POST /api/v1/cash-registers/me/${input.type === "supply"
      ? "supplies" : "withdrawals"}`
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await transaction.selectFrom("cash_sessions").select("id")
        .where("tenant_id", "=", user.tenantId).where("opening_operator_id", "=", user.id)
        .where("status", "=", "open").forUpdate().executeTakeFirst()
      if (!session) throw new AppError(409, "OPEN_CASH_SESSION_REQUIRED", "No open session.")
      if (input.type === "withdrawal") {
        const sum = await transaction.selectFrom("cash_movements")
          .select((expression) => expression.fn.coalesce(
            expression.fn.sum<string>("amount_cents"),
            sql<string>`0`,
          ).as("amount"))
          .where("tenant_id", "=", user.tenantId).where("cash_session_id", "=", session.id)
          .where("payment_method", "=", "cash").executeTakeFirstOrThrow()
        if (Number(sum.amount) < input.amountCents) {
          throw new AppError(409, "INSUFFICIENT_CASH", "Withdrawal exceeds available cash.")
        }
      }
      await transaction.insertInto("cash_movements").values({
        tenant_id: user.tenantId,
        cash_session_id: session.id,
        movement_type: input.type,
        payment_method: "cash",
        amount_cents: input.type === "withdrawal" ? -input.amountCents : input.amountCents,
        source_type: "manual",
        source_id: null,
        actor_user_id: user.id,
        reason: input.reason,
        reversal_of_id: null,
      }).execute()
      await transaction.updateTable("cash_sessions").set({
        version: sql`version + 1`, updated_at: new Date(),
      }).where("id", "=", session.id).execute()
      await recordDomainEvent(transaction, user, {
        action: `cash.${input.type}`, entityType: "cash_session",
        entityId: session.id, reason: input.reason, after: input,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, session.id, 200)
      return session.id
    })
    const session = await this.getSession(user.tenantId, id)
    if (!session) throw new Error("Cash session could not be reloaded")
    return session
  }

  async adminMovement(
    user: AuthenticatedUser,
    sessionId: string,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
    hash: string,
  ): Promise<CashSession> {
    const route = `POST /api/v1/cash-sessions/${sessionId}/${input.type === "supply"
      ? "supplies" : "withdrawals"}`
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await transaction.selectFrom("cash_sessions").select("id")
        .where("tenant_id", "=", user.tenantId).where("id", "=", sessionId)
        .where("status", "=", "open").forUpdate().executeTakeFirst()
      if (!session) {
        throw new AppError(409, "OPEN_CASH_SESSION_REQUIRED", "Cash session is not open.")
      }
      if (input.type === "withdrawal") {
        const sum = await transaction.selectFrom("cash_movements")
          .select((expression) => expression.fn.coalesce(
            expression.fn.sum<string>("amount_cents"),
            sql<string>`0`,
          ).as("amount"))
          .where("tenant_id", "=", user.tenantId)
          .where("cash_session_id", "=", sessionId)
          .where("payment_method", "=", "cash").executeTakeFirstOrThrow()
        if (Number(sum.amount) < input.amountCents) {
          throw new AppError(409, "INSUFFICIENT_CASH", "Withdrawal exceeds available cash.")
        }
      }
      const occurredAt = new Date()
      await transaction.insertInto("cash_movements").values({
        tenant_id: user.tenantId,
        cash_session_id: sessionId,
        movement_type: input.type,
        payment_method: "cash",
        amount_cents: input.type === "withdrawal" ? -input.amountCents : input.amountCents,
        source_type: "admin_manual",
        source_id: null,
        actor_user_id: user.id,
        reason: input.reason,
        occurred_at: occurredAt,
        reversal_of_id: null,
      }).execute()
      await transaction.updateTable("cash_sessions").set({
        version: sql`version + 1`, updated_at: occurredAt,
      }).where("id", "=", sessionId).execute()
      await recordDomainEvent(transaction, user, {
        action: `cash.${input.type}`, entityType: "cash_session",
        entityId: sessionId, reason: input.reason, after: input,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, sessionId, 200)
      return sessionId
    })
    const session = await this.getSession(user.tenantId, id)
    if (!session) throw new Error("Cash session could not be reloaded")
    return session
  }

  async closeSession(
    user: AuthenticatedUser,
    input: {
      version: number
      countedByMethod: Record<PaymentMethod, number>
      note: string | null
    },
    key: string,
    hash: string,
  ): Promise<CashSession> {
    const route = "POST /api/v1/cash-registers/me/close"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const session = await transaction.selectFrom("cash_sessions")
        .select(["id", "version"]).where("tenant_id", "=", user.tenantId)
        .where("opening_operator_id", "=", user.id).where("status", "=", "open")
        .forUpdate().executeTakeFirst()
      if (!session) throw new AppError(409, "OPEN_CASH_SESSION_REQUIRED", "No open session.")
      if (session.version !== input.version) {
        throw new AppError(409, "STALE_VERSION", "Cash session changed. Reload and retry.")
      }
      const totals = await transaction.selectFrom("cash_movements")
        .select([
          "payment_method",
          (expression) => expression.fn.sum<string>("amount_cents").as("amount"),
        ]).where("tenant_id", "=", user.tenantId)
        .where("cash_session_id", "=", session.id).groupBy("payment_method").execute()
      const expected: Record<PaymentMethod, number> = { cash: 0, credit: 0, debit: 0, pix: 0 }
      for (const total of totals) expected[total.payment_method] = Number(total.amount)
      const closedAt = new Date()
      await transaction.insertInto("cash_close_counts").values(
        (Object.keys(expected) as PaymentMethod[]).map((method) => ({
          tenant_id: user.tenantId,
          cash_session_id: session.id,
          payment_method: method,
          expected_amount_cents: expected[method],
          counted_amount_cents: input.countedByMethod[method],
          difference_cents: input.countedByMethod[method] - expected[method],
          actor_user_id: user.id,
          counted_at: closedAt,
        })),
      ).execute()
      await transaction.updateTable("cash_sessions").set({
        status: "closed",
        closing_operator_id: user.id,
        closed_at: closedAt,
        closing_note: input.note,
        version: sql`version + 1`,
        updated_at: closedAt,
      }).where("id", "=", session.id).execute()
      await recordDomainEvent(transaction, user, {
        action: "cash_session.closed", entityType: "cash_session",
        entityId: session.id, after: { expected, ...input },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, session.id, 200)
      return session.id
    })
    const session = await this.getSession(user.tenantId, id)
    if (!session) throw new Error("Closed cash session could not be reloaded")
    return session
  }

  async listSessions(tenantId: string, page: number, pageSize: number) {
    const [ids, total] = await Promise.all([
      this.database.selectFrom("cash_sessions").select("id")
        .where("tenant_id", "=", tenantId).orderBy("opened_at", "desc").orderBy("id", "desc")
        .limit(pageSize).offset((page - 1) * pageSize).execute(),
      this.database.selectFrom("cash_sessions")
        .select((expression) => expression.fn.countAll<string>().as("count"))
        .where("tenant_id", "=", tenantId).executeTakeFirstOrThrow(),
    ])
    const data = await Promise.all(ids.map(async ({ id }) => {
      const session = await this.getSession(tenantId, id)
      if (!session) throw new Error("Cash session disappeared during listing")
      return session
    }))
    return { data, page, pageSize, total: Number(total.count) }
  }
}
