import { sql, type Kysely, type Transaction } from "kysely"
import type { Database } from "../../database/types.js"
import type { AuthenticatedUser } from "../auth/types.js"
import { recordDomainEvent, replayedEntityId, saveEntityIdempotency } from "../../shared/persistence/commands.js"
import type { PermissionKey } from "../../shared/auth/permissions.js"
import type { JobRole } from "./types.js"
import { AppError } from "../../shared/errors/app-error.js"

interface RoleRow {
  id: string; name: string; description: string; status: "active" | "inactive"
  system_key: "administrator" | "operator" | null; version: number
  created_at: Date; updated_at: Date; employee_count: string | number | bigint
}

function mapRole(row: RoleRow, permissions: string[]): JobRole {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status,
    systemKey: row.system_key, permissions: permissions as PermissionKey[],
    employeeCount: Number(row.employee_count), version: row.version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  }
}

export interface JobRoleRepositoryPort {
  list(tenantId: string): Promise<JobRole[]>
  get(tenantId: string, id: string): Promise<JobRole | null>
  replay(user: AuthenticatedUser, route: string, key: string, hash: string): Promise<string | null>
  create(user: AuthenticatedUser, values: { name: string; description: string; permissions: PermissionKey[] }, key: string, hash: string): Promise<JobRole>
  update(user: AuthenticatedUser, current: JobRole, values: { name: string; description: string; status: "active" | "inactive"; permissions: PermissionKey[] }, key: string, hash: string): Promise<JobRole | null>
  archive(user: AuthenticatedUser, current: JobRole, key: string, hash: string): Promise<boolean>
}

export class JobRoleRepository implements JobRoleRepositoryPort {
  constructor(private readonly db: Kysely<Database>) {}

  async list(tenantId: string): Promise<JobRole[]> {
    const rows = await this.db.selectFrom("job_roles as role")
      .select(["role.id", "role.name", "role.description", "role.status", "role.system_key", "role.version", "role.created_at", "role.updated_at"])
      .select((eb) => eb.selectFrom("users").select((e) => e.fn.countAll<string>().as("count"))
        .whereRef("users.job_role_id", "=", "role.id").where("users.archived_at", "is", null).as("employee_count"))
      .where("role.tenant_id", "=", tenantId).where("role.archived_at", "is", null)
      .orderBy(sql`CASE WHEN system_key = 'administrator' THEN 0 WHEN system_key = 'operator' THEN 1 ELSE 2 END`)
      .orderBy("role.name").execute() as RoleRow[]
    const permissions = await this.db.selectFrom("job_role_permissions")
      .select(["job_role_id", "permission_key"]).where("tenant_id", "=", tenantId).execute()
    const grouped = new Map<string, string[]>()
    for (const permission of permissions) grouped.set(permission.job_role_id, [...(grouped.get(permission.job_role_id) ?? []), permission.permission_key])
    return rows.map((row) => mapRole(row, grouped.get(row.id) ?? []))
  }

  async get(tenantId: string, id: string): Promise<JobRole | null> {
    return (await this.list(tenantId)).find((role) => role.id === id) ?? null
  }

  replay(user: AuthenticatedUser, route: string, key: string, hash: string): Promise<string | null> {
    return this.db.transaction().execute((trx) => replayedEntityId(trx, user, route, key, hash))
  }

  private async replacePermissions(transaction: Transaction<Database>, tenantId: string, id: string, permissions: PermissionKey[]) {
    await transaction.deleteFrom("job_role_permissions").where("tenant_id", "=", tenantId).where("job_role_id", "=", id).execute()
    if (permissions.length) await transaction.insertInto("job_role_permissions").values(permissions.map((permission) => ({ tenant_id: tenantId, job_role_id: id, permission_key: permission }))).execute()
  }

  async create(user: AuthenticatedUser, values: { name: string; description: string; permissions: PermissionKey[] }, key: string, hash: string): Promise<JobRole> {
    const route = "POST /api/v1/job-roles"
    const id = await this.db.transaction().execute(async (trx) => {
      const replay = await replayedEntityId(trx, user, route, key, hash); if (replay) return replay
      const row = await trx.insertInto("job_roles").values({ tenant_id: user.tenantId, name: values.name, description: values.description, status: "active", system_key: null, archived_at: null }).returning("id").executeTakeFirstOrThrow()
      await this.replacePermissions(trx, user.tenantId, row.id, values.permissions)
      await recordDomainEvent(trx, user, { action: "job_role.created", entityType: "job_role", entityId: row.id, after: values })
      await saveEntityIdempotency(trx, user, route, key, hash, row.id, 201)
      return row.id
    })
    const role = await this.get(user.tenantId, id)
    if (!role) throw new Error("Created job role could not be reloaded")
    return role
  }

  async update(user: AuthenticatedUser, current: JobRole, values: { name: string; description: string; status: "active" | "inactive"; permissions: PermissionKey[] }, key: string, hash: string): Promise<JobRole | null> {
    const route = `PATCH /api/v1/job-roles/${current.id}`
    const id = await this.db.transaction().execute(async (trx) => {
      const replay = await replayedEntityId(trx, user, route, key, hash); if (replay) return replay
      const locked = await trx.selectFrom("job_roles").select("id")
        .where("tenant_id", "=", user.tenantId).where("id", "=", current.id)
        .where("version", "=", current.version).where("archived_at", "is", null)
        .forUpdate().executeTakeFirst()
      if (!locked) return null
      if (values.status === "inactive") {
        const assigned = await trx.selectFrom("users").select("id")
          .where("tenant_id", "=", user.tenantId).where("job_role_id", "=", current.id)
          .where("archived_at", "is", null).executeTakeFirst()
        if (assigned) throw new AppError(409, "JOB_ROLE_IN_USE", "Reatribua os funcionários antes de inativar este cargo.")
      }
      const row = await trx.updateTable("job_roles").set({ name: values.name, description: values.description, status: values.status, updated_at: new Date(), version: sql`version + 1` })
        .where("tenant_id", "=", user.tenantId).where("id", "=", current.id).where("version", "=", current.version).where("archived_at", "is", null).returning("id").executeTakeFirst()
      if (!row) return null
      await this.replacePermissions(trx, user.tenantId, current.id, values.permissions)
      await recordDomainEvent(trx, user, { action: "job_role.updated", entityType: "job_role", entityId: current.id, before: current, after: values })
      await saveEntityIdempotency(trx, user, route, key, hash, current.id, 200)
      return row.id
    })
    return id ? this.get(user.tenantId, id) : null
  }

  async archive(user: AuthenticatedUser, current: JobRole, key: string, hash: string): Promise<boolean> {
    const route = `DELETE /api/v1/job-roles/${current.id}`
    return this.db.transaction().execute(async (trx) => {
      const replay = await replayedEntityId(trx, user, route, key, hash); if (replay) return true
      const locked = await trx.selectFrom("job_roles").select("id")
        .where("tenant_id", "=", user.tenantId).where("id", "=", current.id)
        .where("version", "=", current.version).where("archived_at", "is", null)
        .forUpdate().executeTakeFirst()
      if (!locked) return false
      const assigned = await trx.selectFrom("users").select("id")
        .where("tenant_id", "=", user.tenantId).where("job_role_id", "=", current.id)
        .where("archived_at", "is", null).executeTakeFirst()
      if (assigned) throw new AppError(409, "JOB_ROLE_IN_USE", "Reatribua os funcionários antes de remover este cargo.")
      const row = await trx.updateTable("job_roles").set({ status: "inactive", archived_at: new Date(), updated_at: new Date(), version: sql`version + 1` })
        .where("tenant_id", "=", user.tenantId).where("id", "=", current.id).where("version", "=", current.version).where("archived_at", "is", null).returning("id").executeTakeFirst()
      if (!row) return false
      await recordDomainEvent(trx, user, { action: "job_role.archived", entityType: "job_role", entityId: current.id, before: current })
      await saveEntityIdempotency(trx, user, route, key, hash, current.id, 204)
      return true
    })
  }
}
