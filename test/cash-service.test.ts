import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { CashRepository } from "../src/modules/cash/cash-repository.js"
import { CashService } from "../src/modules/cash/cash-service.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

function repository(overrides: Partial<CashRepository>): CashRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as keyof Partial<CashRepository>]
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as CashRepository
}

void describe("cash business rules", () => {
  void it("reports when the employee has no assigned register", async () => {
    const service = new CashService(repository({
      getMyRegister: () => Promise.resolve(null),
    }))

    await assert.rejects(
      service.myRegister(user),
      { statusCode: 404, code: "CASH_REGISTER_NOT_ASSIGNED" },
    )
  })

  void it("normalizes the reason for a current-session withdrawal", async () => {
    let reason: string | undefined
    const service = new CashService(repository({
      manualMovement: (_user, input) => {
        reason = input.reason
        return Promise.reject(new Error("stop after capture"))
      },
    }))

    await assert.rejects(service.movement(user, {
      type: "withdrawal",
      amountCents: 100,
      reason: " Troco retirado ",
    }, "withdrawal-key"))

    assert.equal(reason, "Troco retirado")
  })
})
