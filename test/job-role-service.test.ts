import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { JobRoleService } from "../src/modules/job-roles/job-role-service.js"
import type { JobRoleRepositoryPort } from "../src/modules/job-roles/job-role-repository.js"
import type { JobRole } from "../src/modules/job-roles/types.js"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"

const user: AuthenticatedUser = {
  id: "user-1", tenantId: "tenant-1", sessionId: "session-1",
  name: "Admin", email: "admin@example.com", role: "admin",
}

function role(overrides: Partial<JobRole> = {}): JobRole {
  return {
    id: "role-1", name: "Operador", description: "", status: "active",
    systemKey: "operator", permissions: [], employeeCount: 1, version: 1,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

function repository(current: JobRole): JobRoleRepositoryPort {
  return {
    list: () => Promise.resolve([current]),
    get: () => Promise.resolve(current),
    replay: () => Promise.resolve(null),
    create: (_user, values) => Promise.resolve(role({ systemKey: null, name: values.name, permissions: values.permissions })),
    update: (_user, before, values) => Promise.resolve({ ...before, ...values, version: before.version + 1 }),
    archive: () => Promise.resolve(true),
  }
}

void describe("job role business rules", () => {
  void it("allows configuring the operator permissions without renaming the system role", async () => {
    const service = new JobRoleService(repository(role()))
    const updated = await service.update(user, "role-1", {
      version: 1, name: "Outro nome", permissions: ["history.view"],
    }, "key")
    assert.equal(updated.name, "Operador")
    assert.deepEqual(updated.permissions, ["history.view"])
  })

  void it("protects the administrator role", async () => {
    const service = new JobRoleService(repository(role({ systemKey: "administrator", name: "Administrador" })))
    await assert.rejects(
      service.update(user, "role-1", { version: 1, permissions: [] }, "key"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "SYSTEM_JOB_ROLE_PROTECTED",
    )
  })

  void it("rejects unknown permissions", async () => {
    const service = new JobRoleService(repository(role({ systemKey: null, employeeCount: 0 })))
    await assert.rejects(
      service.create(user, { name: "Gerente", permissions: ["unknown.permission"] }, "key"),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_PERMISSION",
    )
  })

  void it("replays a completed update before rejecting the old version", async () => {
    const current = role({ version: 2, permissions: ["history.view"] })
    const repo = repository(current)
    repo.replay = () => Promise.resolve(current.id)
    const service = new JobRoleService(repo)
    const replayed = await service.update(user, current.id, {
      version: 1, permissions: ["history.view"],
    }, "same-key")
    assert.equal(replayed.version, 2)
  })

  void it("replays a completed archive before trying to reload the archived role", async () => {
    const repo = repository(role({ systemKey: null, employeeCount: 0 }))
    repo.replay = () => Promise.resolve("role-1")
    repo.get = () => Promise.reject(new Error("archive should not reload the role"))
    const service = new JobRoleService(repo)
    await service.archive(user, "role-1", 1, "same-key")
  })
})
