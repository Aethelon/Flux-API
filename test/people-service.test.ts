import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PeopleRepository } from "../src/modules/people/people-repository.js"
import { PeopleService } from "../src/modules/people/people-service.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
  jobRole: {
    id: "7fe8c194-2c8e-4702-a895-c13e30d3817d",
    name: "Administrador",
    systemKey: "administrator" as const,
  },
}

const employee = {
  id: user.id,
  name: user.name,
  email: user.email,
  phone: null,
  role: "admin" as const,
  jobRole: user.jobRole,
  status: "active" as const,
  version: 1,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
}

function repository(overrides: Partial<PeopleRepository>): PeopleRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as keyof Partial<PeopleRepository>]
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as PeopleRepository
}

void describe("people business rules", () => {
  void it("prevents an administrator from deactivating their own account", async () => {
    const service = new PeopleService(repository({
      getEmployee: () => Promise.resolve(employee),
    }))

    await assert.rejects(
      service.updateEmployee(user, user.id, { version: 1, status: "inactive" }, "self-key"),
      { statusCode: 409, code: "SELF_ACCESS_CHANGE_FORBIDDEN" },
    )
  })

  void it("prevents the authenticated user from changing their own login email", async () => {
    const service = new PeopleService(repository({
      getEmployee: () => Promise.resolve(employee),
    }))

    await assert.rejects(
      service.updateEmployee(user, user.id, {
        version: 1,
        email: "outro-email@dlara.test",
      }, "self-email-key"),
      { statusCode: 409, code: "SELF_ACCESS_CHANGE_FORBIDDEN" },
    )
  })

  void it("allows the authenticated user to change their own profile fields when the employee projection omits jobRole", async () => {
    let values: Parameters<PeopleRepository["updateEmployee"]>[3] | undefined
    const service = new PeopleService(repository({
      getEmployee: () => {
        const { jobRole: _jobRole, ...projection } = employee
        void _jobRole
        return Promise.resolve(projection)
      },
      updateEmployee: (_user, _id, _version, input) => {
        values = input
        return Promise.resolve({ ...employee, ...input, version: 2 })
      },
    }))

    await service.updateEmployee(user, user.id, {
      version: 1,
      name: "  Novo Nome  ",
      phone: " 81999990000 ",
    }, "self-profile-key")

    assert.ok(values)
    assert.equal(values.name, "Novo Nome")
    assert.equal(values.phone, "81999990000")
    assert.equal(values.email, employee.email)
    assert.equal(values.jobRoleId, employee.jobRole.id)
  })

  void it("prevents the authenticated user from changing their own job role", async () => {
    const operatorRole = {
      id: "c8098f68-bb82-4bfe-8026-0a045f216a35",
      name: "Operador",
      systemKey: "operator" as const,
    }
    const service = new PeopleService(repository({
      getEmployee: () => Promise.resolve(employee),
      getAssignableJobRole: () => Promise.resolve(operatorRole),
    }))

    await assert.rejects(
      service.updateEmployee(user, user.id, {
        version: 1,
        jobRoleId: operatorRole.id,
      }, "self-role-key"),
      { statusCode: 409, code: "SELF_ACCESS_CHANGE_FORBIDDEN" },
    )
  })

  void it("allows an administrator to change another employee's access fields", async () => {
    const operatorRole = {
      id: "c8098f68-bb82-4bfe-8026-0a045f216a35",
      name: "Operador",
      systemKey: "operator" as const,
    }
    const otherEmployee = {
      ...employee,
      id: "63dab5b9-191b-471a-87fb-a2d319cb3cb2",
    }
    let values: Parameters<PeopleRepository["updateEmployee"]>[3] | undefined
    const service = new PeopleService(repository({
      getEmployee: () => Promise.resolve(otherEmployee),
      getAssignableJobRole: () => Promise.resolve(operatorRole),
      updateEmployee: (_user, _id, _version, input) => {
        values = input
        return Promise.resolve({
          ...otherEmployee,
          ...input,
          jobRole: operatorRole,
          version: 2,
        })
      },
    }))

    await service.updateEmployee(user, otherEmployee.id, {
      version: 1,
      email: "outro@dlara.test",
      jobRoleId: operatorRole.id,
      status: "inactive",
    }, "other-access-key")

    assert.ok(values)
    assert.equal(values.email, "outro@dlara.test")
    assert.equal(values.jobRoleId, operatorRole.id)
    assert.equal(values.status, "inactive")
  })

  void it("normalizes customer contact fields", async () => {
    let values: {
      name: string
      email: string | null
      phone: string | null
      notes: string
    } | undefined
    const service = new PeopleService(repository({
      createCustomer: (_user, input) => {
        values = input
        return Promise.reject(new Error("stop after capture"))
      },
    }))

    await assert.rejects(service.createCustomer(user, {
      name: "  Ana Silva ",
      email: " ANA@EXAMPLE.COM ",
      phone: " 81999990000 ",
      notes: " note ",
    }, "customer-key"))

    assert.deepEqual(values, {
      name: "Ana Silva",
      email: "ana@example.com",
      phone: "81999990000",
      notes: "note",
      status: "active",
      consentAt: null,
    })
  })
})
