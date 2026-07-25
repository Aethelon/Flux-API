import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SupplyRepository } from "../src/modules/supply/supply-repository.js"
import { SupplyService } from "../src/modules/supply/supply-service.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

function repository(overrides: Partial<SupplyRepository>): SupplyRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as keyof Partial<SupplyRepository>]
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as SupplyRepository
}

void describe("supply business rules", () => {
  void it("rejects supplier links for services", async () => {
    const service = new SupplyService(repository({
      getSupplier: () => Promise.resolve({
        id: "e742663b-c0ad-4c8d-ab0f-5c207005cc02",
        legalName: "Supplier",
        tradeName: null,
        taxId: null,
        email: null,
        phone: null,
        contactName: null,
        notes: "",
        active: true,
        version: 1,
        createdAt: "2026-07-23T12:00:00.000Z",
        updatedAt: "2026-07-23T12:00:00.000Z",
      }),
      getProductMeta: () => Promise.resolve({
        id: "c2244327-c3ba-41ef-9705-731670d2d074",
        type: "service",
        active: true,
        name: "Installation",
        unitAbbreviation: "serv",
        quantityScale: 0,
      }),
    }))

    await assert.rejects(
      service.createProductSupplier(user, "e742663b-c0ad-4c8d-ab0f-5c207005cc02", {
        productId: "c2244327-c3ba-41ef-9705-731670d2d074",
        leadTimeDays: 1,
        minimumOrderQuantity: 1,
        packMultiple: 1,
      }, "service-link-key"),
      { statusCode: 409, code: "INVALID_SUPPLIER_PRODUCT" },
    )
  })
})
