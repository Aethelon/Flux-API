import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  CatalogRepository,
  ProductRecord,
  ProductWrite,
} from "../src/modules/catalog/catalog-repository.js"
import { CatalogService } from "../src/modules/catalog/catalog-service.js"

const user = {
  id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
  tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
  sessionId: "483dece1-5925-407c-a830-a1d498862be0",
  name: "D'lara Admin",
  email: "admin@dlara.test",
  role: "admin" as const,
}

const category = {
  id: "50334617-f6b8-4076-a28f-fac5473bb053",
  name: "Services",
  active: true,
  version: 1,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
}

const unit = {
  id: "6c5368b1-cadf-4cde-863a-ee54f3c71043",
  name: "Unit",
  abbreviation: "un",
  allowsFractional: false,
  quantityScale: 0,
  active: true,
  version: 1,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
}

const product: ProductRecord = {
  id: "b9d563f7-c670-4dda-875c-b2c12a41d6ad",
  sku: null,
  barcode: null,
  type: "finished_product",
  name: "Product",
  description: "",
  active: true,
  minimumStock: 2,
  priceCents: 10_000,
  costCents: 5_000,
  costSource: "manual",
  categoryId: category.id,
  unitId: unit.id,
  category: {
    id: category.id,
    name: category.name,
  },
  unit: {
    id: unit.id,
    name: unit.name,
    abbreviation: unit.abbreviation,
    allowsFractional: unit.allowsFractional,
    quantityScale: unit.quantityScale,
  },
  version: 1,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
}

function repository(overrides: Partial<CatalogRepository>): CatalogRepository {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof Partial<CatalogRepository>]
      }
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as CatalogRepository
}

void describe("catalog business rules", () => {
  void it("forces service minimum stock to zero", async () => {
    let written: ProductWrite | undefined
    const service = new CatalogService(repository({
      getCategory: () => Promise.resolve(category),
      getUnit: () => Promise.resolve(unit),
      createProduct: (_actor, values) => {
        written = values
        return Promise.resolve({
          ...product,
          ...values,
          type: "service",
          minimumStock: 0,
        })
      },
    }))

    await service.createProduct(user, {
      type: "service",
      name: "Installation",
      categoryId: category.id,
      unitId: unit.id,
      minimumStock: 15,
      priceCents: 20_000,
    })

    assert.equal(written?.minimumStock, 0)
  })

  void it("rejects fractional scale for an indivisible unit", async () => {
    const service = new CatalogService(repository({}))

    await assert.rejects(
      service.createUnit(user, {
        name: "Unit",
        abbreviation: "un",
        allowsFractional: false,
        quantityScale: 2,
      }),
      {
        statusCode: 400,
        code: "INVALID_UNIT_SCALE",
      },
    )
  })

  void it("requires a reason when price changes", async () => {
    const service = new CatalogService(repository({
      getProduct: () => Promise.resolve(product),
      getCategory: () => Promise.resolve(category),
      getUnit: () => Promise.resolve(unit),
    }))

    await assert.rejects(
      service.updateProduct(user, product.id, {
        version: 1,
        priceCents: 11_000,
      }),
      {
        statusCode: 400,
        code: "CHANGE_REASON_REQUIRED",
      },
    )
  })

  void it("does not archive a category used by an active product", async () => {
    const service = new CatalogService(repository({
      getCategory: () => Promise.resolve(category),
      categoryUsageCount: () => Promise.resolve(1),
    }))

    await assert.rejects(
      service.archiveCategory(user, category.id, category.version),
      {
        statusCode: 409,
        code: "CATEGORY_IN_USE",
      },
    )
  })

  void it("does not change a stock-managed product into a service", async () => {
    const service = new CatalogService(repository({
      getProduct: () => Promise.resolve(product),
    }))

    await assert.rejects(
      service.updateProduct(user, product.id, {
        version: product.version,
        type: "service",
      }),
      {
        statusCode: 409,
        code: "PRODUCT_INVENTORY_TYPE_IMMUTABLE",
      },
    )
  })
})
