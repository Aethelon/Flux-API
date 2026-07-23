import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertRole } from "../src/shared/auth/authorization.js"

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
