import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertAnyPermission, assertRole } from "../src/shared/auth/authorization.js"

const employee = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "Employee",
  email: "employee@dlara.test",
  role: "funcionario" as const,
}

void describe("role authorization", () => {
  void it("allows a matching role", () => {
    assert.doesNotThrow(() => {
      assertRole(employee, ["funcionario"])
    })
  })

  void it("returns a forbidden domain error for a missing role", () => {
    assert.throws(
      () => {
        assertRole(employee, ["admin"])
      },
      {
        statusCode: 403,
        code: "FORBIDDEN",
      },
    )
  })
})

void describe("screen authorization", () => {
  void it("allows a screen dependency when the employee has one accepted screen", () => {
    assert.doesNotThrow(() => {
      assertAnyPermission(
        { ...employee, permissions: ["dashboard.view"] },
        ["orders.view", "dashboard.view", "pos.view"],
      )
    })
  })

  void it("blocks a screen dependency when the employee has no accepted screen", () => {
    assert.throws(
      () => assertAnyPermission(
        { ...employee, permissions: ["customers.view"] },
        ["orders.view", "dashboard.view", "pos.view"],
      ),
      { statusCode: 403, code: "FORBIDDEN" },
    )
  })

  void it("keeps administrators authorized independently of configured screens", () => {
    assert.doesNotThrow(() => {
      assertAnyPermission({ ...employee, role: "admin", permissions: [] }, ["dashboard.view"])
    })
  })
})
