import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import { isPermissionKey, PERMISSIONS, type PermissionKey } from "../../shared/auth/permissions.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { JobRoleRepositoryPort } from "./job-role-repository.js"
import type { CreateJobRoleInput, UpdateJobRoleInput } from "./types.js"

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const stale = () => new AppError(409, "STALE_VERSION", "The resource changed. Reload and retry.")

export class JobRoleService {
  constructor(private readonly repository: JobRoleRepositoryPort) {}
  list(tenantId: string) { return this.repository.list(tenantId) }
  permissions() { return [...PERMISSIONS] }
  async get(tenantId: string, id: string) { const role = await this.repository.get(tenantId, id); if (!role) throw new AppError(404, "JOB_ROLE_NOT_FOUND", "Cargo não encontrado."); return role }
  private permissionsOf(values: string[] | undefined, fallback: PermissionKey[] = []): PermissionKey[] {
    const permissions = values ?? fallback
    if (!permissions.every(isPermissionKey)) throw new AppError(400, "INVALID_PERMISSION", "Uma ou mais permissões são inválidas.")
    return [...new Set(permissions)].sort()
  }
  async create(user: AuthenticatedUser, input: CreateJobRoleInput, key: string) {
    const values = { name: input.name.trim(), description: input.description?.trim() ?? "", permissions: this.permissionsOf(input.permissions) }
    if (!values.name) throw new AppError(400, "REQUIRED_FIELD", "O nome do cargo é obrigatório.")
    try { return await this.repository.create(user, values, key, digest(values)) } catch (error) { this.handleDuplicate(error); throw error }
  }
  async update(user: AuthenticatedUser, id: string, input: UpdateJobRoleInput, key: string) {
    const current = await this.get(user.tenantId, id)
    if (current.systemKey === "administrator") throw new AppError(409, "SYSTEM_JOB_ROLE_PROTECTED", "O cargo Administrador é protegido e não pode ser alterado.")
    const values = {
      name: current.systemKey ? current.name : (input.name?.trim() || current.name),
      description: input.description === undefined ? current.description : input.description.trim(),
      status: current.systemKey ? "active" as const : (input.status ?? current.status),
      permissions: this.permissionsOf(input.permissions, current.permissions),
    }
    const requestHash = digest(input)
    const replay = await this.repository.replay(user, `PATCH /api/v1/job-roles/${id}`, key, requestHash)
    if (replay) return this.get(user.tenantId, replay)
    if (current.version !== input.version) throw stale()
    try { const result = await this.repository.update(user, current, values, key, requestHash); if (!result) throw stale(); return result } catch (error) { this.handleDuplicate(error); throw error }
  }
  async archive(user: AuthenticatedUser, id: string, version: number, key: string) {
    const requestHash = digest({ version })
    if (await this.repository.replay(user, `DELETE /api/v1/job-roles/${id}`, key, requestHash)) return
    const current = await this.get(user.tenantId, id)
    if (current.version !== version) throw stale()
    if (current.systemKey) throw new AppError(409, "SYSTEM_JOB_ROLE_PROTECTED", "Cargos de sistema não podem ser removidos.")
    if (current.employeeCount > 0) throw new AppError(409, "JOB_ROLE_IN_USE", "Reatribua os funcionários antes de remover este cargo.")
    if (!await this.repository.archive(user, current, key, requestHash)) throw stale()
  }
  private handleDuplicate(error: unknown): void {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new AppError(409, "DUPLICATE_JOB_ROLE", "Já existe um cargo com esse nome.")
  }
}
