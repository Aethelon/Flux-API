import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import { AppError } from "../../shared/errors/app-error.js"
import {
  recordDomainEvent,
  replayedEntityId,
  saveEntityIdempotency,
} from "../../shared/persistence/commands.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  Customer,
  Employee,
  Page,
  PeopleFilters,
} from "./types.js"

export interface CustomerWrite {
  name: string
  email: string | null
  phone: string | null
  notes: string
  status: "active" | "inactive"
  consentAt: Date | null
}

export interface EmployeeWrite {
  name: string
  email: string
  phone: string | null
  role: "admin" | "funcionario"
  status: "active" | "inactive"
  passwordHash?: string
}

export interface PeopleRepository {
  listCustomers(tenantId: string, filters: PeopleFilters): Promise<Page<Customer>>
  getCustomer(tenantId: string, id: string): Promise<Customer | null>
  createCustomer(
    user: AuthenticatedUser,
    values: CustomerWrite,
    key: string,
    hash: string,
  ): Promise<Customer>
  updateCustomer(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: CustomerWrite,
    before: Customer,
    key: string,
    hash: string,
  ): Promise<Customer | null>
  archiveCustomer(
    user: AuthenticatedUser,
    id: string,
    version: number,
    before: Customer,
    key: string,
    hash: string,
  ): Promise<boolean>
  listEmployees(tenantId: string, filters: PeopleFilters): Promise<Page<Employee>>
  getEmployee(tenantId: string, id: string): Promise<Employee | null>
  createEmployee(
    user: AuthenticatedUser,
    values: EmployeeWrite & { passwordHash: string },
    key: string,
    hash: string,
  ): Promise<Employee>
  updateEmployee(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: EmployeeWrite,
    before: Employee,
    key: string,
    hash: string,
  ): Promise<Employee | null>
  archiveEmployee(
    user: AuthenticatedUser,
    id: string,
    version: number,
    before: Employee,
    key: string,
    hash: string,
  ): Promise<boolean>
}

function mapCustomer(row: {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string
  status: "active" | "inactive"
  consent_at: Date | null
  anonymized_at: Date | null
  version: number
  created_at: Date
  updated_at: Date
}): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    consentAt: row.consent_at?.toISOString() ?? null,
    anonymizedAt: row.anonymized_at?.toISOString() ?? null,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapEmployee(row: {
  id: string
  name: string
  email: string
  phone: string | null
  role: "admin" | "funcionario"
  status: "active" | "inactive"
  version: number
  created_at: Date
  updated_at: Date
}): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function customerSelection() {
  return [
    "id",
    "name",
    "email",
    "phone",
    "notes",
    "status",
    "consent_at",
    "anonymized_at",
    "version",
    "created_at",
    "updated_at",
  ] as const
}

function employeeSelection() {
  return [
    "id",
    "name",
    "email",
    "phone",
    "role",
    "status",
    "version",
    "created_at",
    "updated_at",
  ] as const
}

export class KyselyPeopleRepository implements PeopleRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async listCustomers(tenantId: string, filters: PeopleFilters): Promise<Page<Customer>> {
    let query = this.database
      .selectFrom("customers")
      .select(customerSelection())
      .where("tenant_id", "=", tenantId)
      .where("archived_at", "is", null)
    let count = this.database.selectFrom("customers")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("archived_at", "is", null)

    if (filters.search) {
      const pattern = `%${filters.search}%`
      query = query.where((expression) => expression.or([
        expression("name", "ilike", pattern),
        expression("email", "ilike", pattern),
        expression("phone", "ilike", pattern),
      ]))
      count = count.where((expression) => expression.or([
        expression("name", "ilike", pattern),
        expression("email", "ilike", pattern),
        expression("phone", "ilike", pattern),
      ]))
    }
    if (filters.status) {
      query = query.where("status", "=", filters.status)
      count = count.where("status", "=", filters.status)
    }

    const [rows, total] = await Promise.all([
      query.orderBy("name").orderBy("id")
        .limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize).execute(),
      count.executeTakeFirstOrThrow(),
    ])
    return {
      data: rows.map(mapCustomer),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(total.count),
    }
  }

  async getCustomer(tenantId: string, id: string): Promise<Customer | null> {
    const row = await this.database.selectFrom("customers").select(customerSelection())
      .where("tenant_id", "=", tenantId).where("id", "=", id)
      .where("archived_at", "is", null).executeTakeFirst()
    return row ? mapCustomer(row) : null
  }

  async createCustomer(
    user: AuthenticatedUser,
    values: CustomerWrite,
    key: string,
    hash: string,
  ): Promise<Customer> {
    const route = "POST /api/v1/customers"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("customers").values({
        tenant_id: user.tenantId,
        name: values.name,
        email: values.email,
        phone: values.phone,
        notes: values.notes,
        status: values.status,
        consent_at: values.consentAt,
        anonymized_at: null,
        created_by: user.id,
        updated_by: user.id,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "customer.created",
        entityType: "customer",
        entityId: row.id,
        after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const customer = await this.getCustomer(user.tenantId, id)
    if (!customer) throw new Error("Created customer could not be reloaded")
    return customer
  }

  async updateCustomer(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: CustomerWrite,
    before: Customer,
    key: string,
    hash: string,
  ): Promise<Customer | null> {
    const route = `PATCH /api/v1/customers/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.updateTable("customers").set({
        name: values.name,
        email: values.email,
        phone: values.phone,
        notes: values.notes,
        status: values.status,
        consent_at: values.consentAt,
        updated_by: user.id,
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return null
      await recordDomainEvent(transaction, user, {
        action: "customer.updated",
        entityType: "customer",
        entityId: id,
        before,
        after: values,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getCustomer(user.tenantId, result) : null
  }

  async archiveCustomer(
    user: AuthenticatedUser,
    id: string,
    version: number,
    before: Customer,
    key: string,
    hash: string,
  ): Promise<boolean> {
    const route = `DELETE /api/v1/customers/${id}`
    return this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return true
      const row = await transaction.updateTable("customers").set({
        status: "inactive",
        archived_at: new Date(),
        updated_at: new Date(),
        updated_by: user.id,
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return false
      await recordDomainEvent(transaction, user, {
        action: "customer.archived",
        entityType: "customer",
        entityId: id,
        before,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 204)
      return true
    })
  }

  async listEmployees(tenantId: string, filters: PeopleFilters): Promise<Page<Employee>> {
    let query = this.database.selectFrom("users").select(employeeSelection())
      .where("tenant_id", "=", tenantId).where("archived_at", "is", null)
    let count = this.database.selectFrom("users")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId).where("archived_at", "is", null)
    if (filters.search) {
      const pattern = `%${filters.search}%`
      query = query.where((expression) => expression.or([
        expression("name", "ilike", pattern),
        expression("email", "ilike", pattern),
        expression("phone", "ilike", pattern),
      ]))
      count = count.where((expression) => expression.or([
        expression("name", "ilike", pattern),
        expression("email", "ilike", pattern),
        expression("phone", "ilike", pattern),
      ]))
    }
    if (filters.status) {
      query = query.where("status", "=", filters.status)
      count = count.where("status", "=", filters.status)
    }
    const [rows, total] = await Promise.all([
      query.orderBy("name").orderBy("id")
        .limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize).execute(),
      count.executeTakeFirstOrThrow(),
    ])
    return {
      data: rows.map(mapEmployee),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(total.count),
    }
  }

  async getEmployee(tenantId: string, id: string): Promise<Employee | null> {
    const row = await this.database.selectFrom("users").select(employeeSelection())
      .where("tenant_id", "=", tenantId).where("id", "=", id)
      .where("archived_at", "is", null).executeTakeFirst()
    return row ? mapEmployee(row) : null
  }

  async createEmployee(
    user: AuthenticatedUser,
    values: EmployeeWrite & { passwordHash: string },
    key: string,
    hash: string,
  ): Promise<Employee> {
    const route = "POST /api/v1/employees"
    const id = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      const row = await transaction.insertInto("users").values({
        tenant_id: user.tenantId,
        name: values.name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        status: values.status,
        password_hash: values.passwordHash,
        archived_at: null,
      }).returning("id").executeTakeFirstOrThrow()
      await recordDomainEvent(transaction, user, {
        action: "employee.created",
        entityType: "user",
        entityId: row.id,
        after: {
          name: values.name,
          email: values.email,
          phone: values.phone,
          role: values.role,
          status: values.status,
        },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, row.id, 201)
      return row.id
    })
    const employee = await this.getEmployee(user.tenantId, id)
    if (!employee) throw new Error("Created employee could not be reloaded")
    return employee
  }

  async updateEmployee(
    user: AuthenticatedUser,
    id: string,
    version: number,
    values: EmployeeWrite,
    before: Employee,
    key: string,
    hash: string,
  ): Promise<Employee | null> {
    const route = `PATCH /api/v1/employees/${id}`
    const result = await this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return replay
      if (values.status === "inactive") {
        const openSession = await transaction.selectFrom("cash_sessions").select("id")
          .where("tenant_id", "=", user.tenantId).where("opening_operator_id", "=", id)
          .where("status", "=", "open").executeTakeFirst()
        if (openSession) {
          throw new AppError(
            409,
            "OPEN_CASH_SESSION_BLOCKS_EMPLOYEE_CHANGE",
            "Close the employee cash session before deactivating the account.",
          )
        }
      }
      const row = await transaction.updateTable("users").set({
        name: values.name,
        email: values.email,
        phone: values.phone,
        role: values.role,
        status: values.status,
        ...(values.passwordHash ? { password_hash: values.passwordHash } : {}),
        updated_at: new Date(),
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return null
      if (values.status === "inactive") {
        const occurredAt = new Date()
        await transaction.updateTable("auth_sessions").set({
          revoked_at: occurredAt,
          revoke_reason: "employee_inactivated",
        }).where("tenant_id", "=", user.tenantId).where("user_id", "=", id)
          .where("revoked_at", "is", null).execute()
        await transaction.updateTable("cash_register_assignments").set({
          valid_until: occurredAt,
        }).where("tenant_id", "=", user.tenantId).where("user_id", "=", id)
          .where("valid_until", "is", null).execute()
      }
      await recordDomainEvent(transaction, user, {
        action: "employee.updated",
        entityType: "user",
        entityId: id,
        before,
        after: {
          name: values.name,
          email: values.email,
          phone: values.phone,
          role: values.role,
          status: values.status,
          passwordChanged: values.passwordHash !== undefined,
        },
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 200)
      return id
    })
    return result ? this.getEmployee(user.tenantId, result) : null
  }

  async archiveEmployee(
    user: AuthenticatedUser,
    id: string,
    version: number,
    before: Employee,
    key: string,
    hash: string,
  ): Promise<boolean> {
    const route = `DELETE /api/v1/employees/${id}`
    return this.database.transaction().execute(async (transaction) => {
      const replay = await replayedEntityId(transaction, user, route, key, hash)
      if (replay) return true
      const openSession = await transaction.selectFrom("cash_sessions").select("id")
        .where("tenant_id", "=", user.tenantId).where("opening_operator_id", "=", id)
        .where("status", "=", "open").executeTakeFirst()
      if (openSession) {
        throw new AppError(
          409,
          "OPEN_CASH_SESSION_BLOCKS_EMPLOYEE_CHANGE",
          "Close the employee cash session before archiving the account.",
        )
      }
      const occurredAt = new Date()
      const row = await transaction.updateTable("users").set({
        status: "inactive",
        archived_at: occurredAt,
        updated_at: occurredAt,
        version: sql`version + 1`,
      }).where("tenant_id", "=", user.tenantId).where("id", "=", id)
        .where("version", "=", version).where("archived_at", "is", null)
        .returning("id").executeTakeFirst()
      if (!row) return false
      await transaction.updateTable("auth_sessions").set({
        revoked_at: occurredAt,
        revoke_reason: "employee_archived",
      }).where("tenant_id", "=", user.tenantId).where("user_id", "=", id)
        .where("revoked_at", "is", null).execute()
      await transaction.updateTable("cash_register_assignments").set({
        valid_until: occurredAt,
      }).where("tenant_id", "=", user.tenantId).where("user_id", "=", id)
        .where("valid_until", "is", null).execute()
      await recordDomainEvent(transaction, user, {
        action: "employee.archived",
        entityType: "user",
        entityId: id,
        before,
      })
      await saveEntityIdempotency(transaction, user, route, key, hash, id, 204)
      return true
    })
  }
}
