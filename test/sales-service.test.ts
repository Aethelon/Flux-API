import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SalesRepository } from "../src/modules/sales/sales-repository.js"
import { allocateDiscount, quantityMatchesScale } from "../src/modules/sales/sales-calculations.js"
import { SalesService } from "../src/modules/sales/sales-service.js"
import type { CreateSaleInput } from "../src/modules/sales/types.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

function repository(overrides: Partial<SalesRepository>): SalesRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as keyof Partial<SalesRepository>]
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as SalesRepository
}

void describe("sales business rules", () => {
  void it("allocates the cent remainder to the largest line", () => {
    const allocation = allocateDiscount([
      { key: "smaller", grossAmountCents: 100 },
      { key: "larger", grossAmountCents: 200 },
    ], 100)

    assert.equal(allocation.get("smaller"), 33)
    assert.equal(allocation.get("larger"), 67)
  })

  void it("uses the stable key tie-breaker for equal lines", () => {
    const allocation = allocateDiscount([
      { key: "b", grossAmountCents: 100 },
      { key: "a", grossAmountCents: 100 },
    ], 1)

    assert.equal(allocation.get("a"), 1)
    assert.equal(allocation.get("b"), 0)
  })

  void it("rejects discounts above the sale gross amount", () => {
    assert.throws(
      () => allocateDiscount([{ key: "line", grossAmountCents: 100 }], 101),
      { statusCode: 400, code: "INVALID_SALE_DISCOUNT" },
    )
  })

  void it("checks fractional quantities against the unit scale", () => {
    assert.equal(quantityMatchesScale(1.25, 2), true)
    assert.equal(quantityMatchesScale(1.25, 1), false)
  })

  void it("rejects duplicate product and service-order sources", () => {
    const service = new SalesService(repository({}))

    assert.throws(
      () => service.create(user, {
        items: [
          { serviceOrderId: "8c01d2be-d3f7-4c2c-9cd2-f5d7e5c38a10" },
          { serviceOrderId: "8c01d2be-d3f7-4c2c-9cd2-f5d7e5c38a10" },
        ],
        payments: [],
      }, "duplicate-key"),
      { statusCode: 400, code: "DUPLICATE_SALE_ITEM" },
    )
  })

  void it("normalizes and deterministically sorts sale input", async () => {
    let written: CreateSaleInput | undefined
    const service = new SalesService(repository({
      create: (_user, input) => {
        written = input
        return Promise.reject(new Error("stop after capture"))
      },
    }))

    await assert.rejects(service.create(user, {
      items: [
        { serviceOrderId: "8c01d2be-d3f7-4c2c-9cd2-f5d7e5c38a10" },
        { productId: "0e0251e0-44e4-4ff2-a45a-e0ef7cc91fc0", quantity: 1 },
      ],
      payments: [{
        method: "pix",
        amountCents: 500,
        externalReference: " PIX-1 ",
      }],
    }, "capture-key"))

    assert.ok(written)
    const firstItem = written.items[0]
    assert.ok(firstItem)
    assert.ok("serviceOrderId" in firstItem)
    assert.equal(written.payments[0]?.externalReference, "PIX-1")
    assert.equal(written.discountAmountCents, 0)
    assert.equal(written.changeAmountCents, 0)
  })
})
