import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { StockCountRepository } from "../src/modules/inventory/stock-count-repository.js"
import { StockCountService } from "../src/modules/inventory/stock-count-service.js"
import type {
  ConfirmStockCountInput,
  CreateStockCountInput,
  StockCount,
} from "../src/modules/inventory/types.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

const firstProductId = "037cf6d6-ec25-4328-8493-e936e9a83a0a"
const secondProductId = "b9d563f7-c670-4dda-875c-b2c12a41d6ad"

const count: StockCount = {
  id: "b601bd24-8a11-4e9d-879e-0be1af540d99",
  status: "draft",
  reason: "Monthly count",
  startedBy: {
    id: user.id,
    name: user.name,
  },
  startedAt: "2026-07-24T12:00:00.000Z",
  confirmedBy: null,
  confirmedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  cancellationReason: null,
  version: 1,
  items: [],
}

function repository(overrides: Partial<StockCountRepository>): StockCountRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof Partial<StockCountRepository>]
      }
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as StockCountRepository
}

void describe("stock count business rules", () => {
  void it("normalizes reason and product order before creating a count", async () => {
    let written: CreateStockCountInput | undefined
    let hash: string | undefined
    const service = new StockCountService(repository({
      create: (_actor, input, _key, requestHash) => {
        written = input
        hash = requestHash
        return Promise.resolve(count)
      },
    }))

    await service.create(user, {
      reason: " Monthly count ",
      productIds: [secondProductId, firstProductId],
    }, "create-key")

    assert.ok(written)
    assert.equal(written.reason, "Monthly count")
    assert.deepEqual(written.productIds, [firstProductId, secondProductId])
    assert.equal(hash?.length, 64)
  })

  void it("rejects duplicate products in a count", () => {
    const service = new StockCountService(repository({}))

    assert.throws(
      () => service.create(user, {
        reason: "Monthly count",
        productIds: [firstProductId, firstProductId],
      }, "duplicate-key"),
      {
        statusCode: 400,
        code: "DUPLICATE_COUNT_PRODUCT",
      },
    )
  })

  void it("sorts confirmation items for a stable idempotency hash", async () => {
    let written: ConfirmStockCountInput | undefined
    const service = new StockCountService(repository({
      confirm: (_actor, _countId, input) => {
        written = input
        return Promise.resolve({
          ...count,
          status: "confirmed",
          version: 2,
        })
      },
    }))

    await service.confirm(user, count.id, {
      version: 1,
      items: [
        { productId: secondProductId, countedQuantity: 5 },
        { productId: firstProductId, countedQuantity: 3 },
      ],
    }, "confirm-key")

    assert.ok(written)
    assert.deepEqual(
      written.items.map((item) => item.productId),
      [firstProductId, secondProductId],
    )
  })

  void it("returns not found for an unknown count", async () => {
    const service = new StockCountService(repository({
      get: () => Promise.resolve(null),
    }))

    await assert.rejects(
      service.get(user.tenantId, count.id),
      {
        statusCode: 404,
        code: "STOCK_COUNT_NOT_FOUND",
      },
    )
  })
})
