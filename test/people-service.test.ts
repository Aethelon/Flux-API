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
}

const employee = {
  id: user.id,
  name: user.name,
  email: user.email,
  phone: null,
  role: "admin" as const,
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
