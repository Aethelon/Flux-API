import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { InventoryRepository } from "../src/modules/inventory/inventory-repository.js"
import { InventoryService } from "../src/modules/inventory/inventory-service.js"
import type {
  CreateManualMovementInput,
  StockMovement,
} from "../src/modules/inventory/types.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

const product = {
  id: "b9d563f7-c670-4dda-875c-b2c12a41d6ad",
  type: "finished_product" as const,
  active: true,
  quantityScale: 0,
}

const movement: StockMovement = {
  id: "c7da6db1-b461-4699-bd70-88603ee490c2",
  product: {
    id: product.id,
    name: "Product",
    sku: null,
    unitAbbreviation: "un",
  },
  type: "receipt",
  quantity: 10,
  resultingOnHand: 10,
  resultingReserved: 0,
  unitCostSnapshotCents: 500,
  sourceType: "manual_receipt",
  sourceId: null,
  sourceReference: null,
  reason: "Initial receipt",
  actor: {
    id: user.id,
    name: user.name,
  },
  occurredAt: "2026-07-23T12:00:00.000Z",
  reversalOfId: null,
}

function repository(overrides: Partial<InventoryRepository>): InventoryRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof Partial<InventoryRepository>]
      }
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as InventoryRepository
}

void describe("inventory business rules", () => {
  void it("rejects stock movements for services", async () => {
    const service = new InventoryService(repository({
      getStockProduct: () => Promise.resolve({
        ...product,
        type: "service",
      }),
    }))

    await assert.rejects(
      service.postManualMovement(user, {
        productId: product.id,
        type: "receipt",
        quantity: 1,
        unitCostCents: 500,
        reason: "Initial receipt",
      }, "service-key"),
      {
        statusCode: 409,
        code: "SERVICE_HAS_NO_INVENTORY",
      },
    )
  })

  void it("enforces the product unit quantity scale", async () => {
    const service = new InventoryService(repository({
      getStockProduct: () => Promise.resolve(product),
    }))

    await assert.rejects(
      service.postManualMovement(user, {
        productId: product.id,
        type: "receipt",
        quantity: 1.5,
        unitCostCents: 500,
        reason: "Initial receipt",
      }, "scale-key"),
      {
        statusCode: 400,
        code: "INVALID_QUANTITY_SCALE",
      },
    )
  })

  void it("requires unit cost for positive stock", async () => {
    const service = new InventoryService(repository({
      getStockProduct: () => Promise.resolve(product),
    }))

    await assert.rejects(
      service.postManualMovement(user, {
        productId: product.id,
        type: "positive_adjustment",
        quantity: 2,
        reason: "Count correction",
      }, "cost-key"),
      {
        statusCode: 400,
        code: "UNIT_COST_REQUIRED",
      },
    )
  })

  void it("returns a conflict when stock would become unavailable", async () => {
    const service = new InventoryService(repository({
      getStockProduct: () => Promise.resolve(product),
      postManualMovement: () => Promise.resolve(null),
    }))

    await assert.rejects(
      service.postManualMovement(user, {
        productId: product.id,
        type: "negative_adjustment",
        quantity: 20,
        reason: "Damaged items",
      }, "stock-key"),
      {
        statusCode: 409,
        code: "INSUFFICIENT_STOCK",
      },
    )
  })

  void it("normalizes the reason and source reference before persisting", async () => {
    let written: CreateManualMovementInput | undefined
    const service = new InventoryService(repository({
      getStockProduct: () => Promise.resolve(product),
      postManualMovement: (_actor, input) => {
        written = input
        return Promise.resolve(movement)
      },
    }))

    await service.postManualMovement(user, {
      productId: product.id,
      type: "receipt",
      quantity: 10,
      unitCostCents: 500,
      sourceReference: " NF-001 ",
      reason: " Initial receipt ",
    }, "normalization-key")

    assert.ok(written)
    assert.equal(written.reason, "Initial receipt")
    assert.equal(written.sourceReference, "NF-001")
  })

  void it("rejects an invalid movement cursor", async () => {
    const service = new InventoryService(repository({}))

    await assert.rejects(
      service.listMovements(user.tenantId, {
        limit: 25,
        cursor: "invalid",
      }),
      {
        statusCode: 400,
        code: "INVALID_CURSOR",
      },
    )
  })

  void it("returns an opaque cursor when another movement page exists", async () => {
    const service = new InventoryService(repository({
      listMovements: () => Promise.resolve({
        data: [movement],
        hasMore: true,
      }),
    }))

    const page = await service.listMovements(user.tenantId, { limit: 1 })

    assert.deepEqual(page.data, [movement])
    assert.ok(page.nextCursor)
  })
})
