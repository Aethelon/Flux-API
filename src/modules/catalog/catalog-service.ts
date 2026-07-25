import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  CatalogRepository,
  ProductRecord,
  ProductWrite,
} from "./catalog-repository.js"
import type {
  Category,
  CostHistoryEntry,
  CreateProductInput,
  PriceHistoryEntry,
  Product,
  ProductFilters,
  ProductList,
  Unit,
  UpdateProductInput,
} from "./types.js"

interface CreateCategoryInput {
  name: string
  active?: boolean
}

interface UpdateCategoryInput {
  version: number
  name?: string
  active?: boolean
}

interface CreateUnitInput {
  name: string
  abbreviation: string
  allowsFractional?: boolean
  quantityScale?: number
  active?: boolean
}

interface UpdateUnitInput {
  version: number
  name?: string
  abbreviation?: string
  allowsFractional?: boolean
  quantityScale?: number
  active?: boolean
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function notFound(entity: string): AppError {
  return new AppError(404, "NOT_FOUND", `${entity} was not found.`)
}

function staleVersion(): AppError {
  return new AppError(409, "STALE_VERSION", "The resource was changed by another request.")
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
}

function throwCatalogWriteError(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new AppError(
      409,
      "DUPLICATE_CATALOG_VALUE",
      "A catalog record with the same unique value already exists.",
    )
  }

  throw error instanceof Error
    ? error
    : new Error("Unknown catalog persistence error", { cause: error })
}

function trimRequired(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} cannot be blank.`)
  }
  return normalized
}

function nullableIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value.trim() || null
}

function validateUnitSettings(allowsFractional: boolean, quantityScale: number): void {
  if (
    (!allowsFractional && quantityScale !== 0)
    || (allowsFractional && (quantityScale < 1 || quantityScale > 3))
  ) {
    throw new AppError(
      400,
      "INVALID_UNIT_SCALE",
      "Fractional units require a quantity scale from 1 to 3; indivisible units require scale 0.",
    )
  }
}

function hasValidScale(value: number, scale: number): boolean {
  const multiplier = 10 ** scale
  return Number.isInteger(Math.round(value * multiplier))
    && Math.abs(value * multiplier - Math.round(value * multiplier)) < 1e-9
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  listCategories(tenantId: string, includeArchived = false): Promise<Category[]> {
    return this.repository.listCategories(tenantId, includeArchived)
  }

  async getCategory(tenantId: string, id: string): Promise<Category> {
    const category = await this.repository.getCategory(tenantId, id)
    if (!category) throw notFound("Category")
    return category
  }

  async createCategory(
    user: AuthenticatedUser,
    input: CreateCategoryInput,
    idempotencyKey: string,
  ): Promise<Category> {
    const values = {
      name: trimRequired(input.name, "Category name"),
      active: input.active ?? true,
    }
    try {
      return await this.repository.createCategory(
        user,
        values.name,
        values.active,
        idempotencyKey,
        requestHash(values),
      )
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async updateCategory(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCategoryInput,
    idempotencyKey: string,
  ): Promise<Category> {
    const current = await this.getCategory(user.tenantId, id)
    if (input.name === undefined && input.active === undefined) {
      throw new AppError(400, "NO_CHANGES", "At least one field must be changed.")
    }

    try {
      const updated = await this.repository.updateCategory(
        user,
        id,
        input.version,
        {
          name: input.name === undefined
            ? current.name
            : trimRequired(input.name, "Category name"),
          active: input.active ?? current.active,
        },
        current,
        idempotencyKey,
        requestHash({
          version: input.version,
          name: input.name === undefined
            ? current.name
            : trimRequired(input.name, "Category name"),
          active: input.active ?? current.active,
        }),
      )

      if (!updated) throw staleVersion()
      return updated
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async archiveCategory(
    user: AuthenticatedUser,
    id: string,
    version: number,
    idempotencyKey: string,
  ): Promise<void> {
    const current = await this.repository.getCategory(user.tenantId, id, true)
    if (!current) throw notFound("Category")
    if (await this.repository.categoryUsageCount(user.tenantId, id) > 0) {
      throw new AppError(
        409,
        "CATEGORY_IN_USE",
        "A category referenced by active products cannot be archived.",
      )
    }
    if (!await this.repository.archiveCategory(
      user,
      id,
      version,
      current,
      idempotencyKey,
      requestHash({ version }),
    )) {
      throw staleVersion()
    }
  }

  listUnits(tenantId: string, includeArchived = false): Promise<Unit[]> {
    return this.repository.listUnits(tenantId, includeArchived)
  }

  async getUnit(tenantId: string, id: string): Promise<Unit> {
    const unit = await this.repository.getUnit(tenantId, id)
    if (!unit) throw notFound("Unit")
    return unit
  }

  async createUnit(
    user: AuthenticatedUser,
    input: CreateUnitInput,
    idempotencyKey: string,
  ): Promise<Unit> {
    const allowsFractional = input.allowsFractional ?? false
    const quantityScale = input.quantityScale ?? (allowsFractional ? 3 : 0)
    validateUnitSettings(allowsFractional, quantityScale)

    try {
      const values = {
        name: trimRequired(input.name, "Unit name"),
        abbreviation: trimRequired(input.abbreviation, "Unit abbreviation"),
        allowsFractional,
        quantityScale,
        active: input.active ?? true,
      }
      return await this.repository.createUnit(
        user,
        values,
        idempotencyKey,
        requestHash(values),
      )
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async updateUnit(
    user: AuthenticatedUser,
    id: string,
    input: UpdateUnitInput,
    idempotencyKey: string,
  ): Promise<Unit> {
    const current = await this.getUnit(user.tenantId, id)
    if (Object.keys(input).length === 1) {
      throw new AppError(400, "NO_CHANGES", "At least one field must be changed.")
    }

    const allowsFractional = input.allowsFractional ?? current.allowsFractional
    const quantityScale = input.quantityScale
      ?? (input.allowsFractional === false ? 0 : current.quantityScale)
    validateUnitSettings(allowsFractional, quantityScale)
    if (
      (allowsFractional !== current.allowsFractional
        || quantityScale !== current.quantityScale)
      && await this.repository.unitUsageCount(user.tenantId, id) > 0
    ) {
      throw new AppError(
        409,
        "UNIT_SCALE_IN_USE",
        "The quantity scale of a unit referenced by active products cannot be changed.",
      )
    }

    try {
      const updated = await this.repository.updateUnit(
        user,
        id,
        input.version,
        {
          name: input.name === undefined
            ? current.name
            : trimRequired(input.name, "Unit name"),
          abbreviation: input.abbreviation === undefined
            ? current.abbreviation
            : trimRequired(input.abbreviation, "Unit abbreviation"),
          allowsFractional,
          quantityScale,
          active: input.active ?? current.active,
        },
        current,
        idempotencyKey,
        requestHash({
          version: input.version,
          name: input.name === undefined
            ? current.name
            : trimRequired(input.name, "Unit name"),
          abbreviation: input.abbreviation === undefined
            ? current.abbreviation
            : trimRequired(input.abbreviation, "Unit abbreviation"),
          allowsFractional,
          quantityScale,
          active: input.active ?? current.active,
        }),
      )

      if (!updated) throw staleVersion()
      return updated
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async archiveUnit(
    user: AuthenticatedUser,
    id: string,
    version: number,
    idempotencyKey: string,
  ): Promise<void> {
    const current = await this.repository.getUnit(user.tenantId, id, true)
    if (!current) throw notFound("Unit")
    if (await this.repository.unitUsageCount(user.tenantId, id) > 0) {
      throw new AppError(
        409,
        "UNIT_IN_USE",
        "A unit referenced by active products cannot be archived.",
      )
    }
    if (!await this.repository.archiveUnit(
      user,
      id,
      version,
      current,
      idempotencyKey,
      requestHash({ version }),
    )) {
      throw staleVersion()
    }
  }

  listProducts(tenantId: string, filters: ProductFilters): Promise<ProductList> {
    return this.repository.listProducts(tenantId, filters)
  }

  async getProduct(tenantId: string, id: string): Promise<Product> {
    const product = await this.repository.getProduct(tenantId, id)
    if (!product) throw notFound("Product")
    return product
  }

  async createProduct(
    user: AuthenticatedUser,
    input: CreateProductInput,
    idempotencyKey: string,
  ): Promise<Product> {
    const values = await this.prepareProductWrite(user, input)

    try {
      return await this.repository.createProduct(
        user,
        values,
        idempotencyKey,
        requestHash(values),
      )
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async updateProduct(
    user: AuthenticatedUser,
    id: string,
    input: UpdateProductInput,
    idempotencyKey: string,
  ): Promise<Product> {
    const current = await this.getProductRecord(user.tenantId, id)

    const merged: CreateProductInput = {
      sku: input.sku === undefined ? current.sku : input.sku,
      barcode: input.barcode === undefined ? current.barcode : input.barcode,
      type: input.type ?? current.type,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      active: input.active ?? current.active,
      minimumStock: input.minimumStock ?? current.minimumStock,
      priceCents: input.priceCents ?? current.priceCents,
      costCents: input.costCents === undefined ? current.costCents : input.costCents,
      costSource: input.costSource === undefined
        ? input.costCents === null ? null : current.costSource
        : input.costSource,
      categoryId: input.categoryId ?? current.categoryId,
      unitId: input.unitId ?? current.unitId,
    }
    if (
      merged.type !== current.type
      && (merged.type === "service" || current.type === "service")
    ) {
      throw new AppError(
        409,
        "PRODUCT_INVENTORY_TYPE_IMMUTABLE",
        "A product cannot be changed between service and stock-managed types.",
      )
    }
    const values = await this.prepareProductWrite(user, merged, current)
    const priceChanged = current.priceCents !== values.priceCents
    const costChanged = current.costCents !== values.costCents
      || current.costSource !== values.costSource

    if ((priceChanged || costChanged) && !input.changeReason?.trim()) {
      throw new AppError(
        400,
        "CHANGE_REASON_REQUIRED",
        "A reason is required when price or cost changes.",
      )
    }

    try {
      const updated = await this.repository.updateProduct(
        user,
        id,
        input.version,
        values,
        current,
        input.changeReason?.trim() ?? null,
        idempotencyKey,
        requestHash({
          version: input.version,
          ...values,
          changeReason: input.changeReason?.trim() ?? null,
        }),
      )
      if (!updated) throw staleVersion()
      return updated
    } catch (error) {
      throwCatalogWriteError(error)
    }
  }

  async archiveProduct(
    user: AuthenticatedUser,
    id: string,
    version: number,
    idempotencyKey: string,
  ): Promise<void> {
    const current = await this.repository.getProduct(user.tenantId, id, true)
    if (!current) throw notFound("Product")
    if (!await this.repository.archiveProduct(
      user,
      id,
      version,
      current,
      idempotencyKey,
      requestHash({ version }),
    )) {
      throw staleVersion()
    }
  }

  async listPriceHistory(
    tenantId: string,
    productId: string,
  ): Promise<PriceHistoryEntry[]> {
    if (!await this.repository.productExists(tenantId, productId)) {
      throw notFound("Product")
    }
    return this.repository.listPriceHistory(tenantId, productId)
  }

  async listCostHistory(
    tenantId: string,
    productId: string,
  ): Promise<CostHistoryEntry[]> {
    if (!await this.repository.productExists(tenantId, productId)) {
      throw notFound("Product")
    }
    return this.repository.listCostHistory(tenantId, productId)
  }

  private async getProductRecord(tenantId: string, id: string): Promise<ProductRecord> {
    const product = await this.repository.getProduct(tenantId, id)
    if (!product) throw notFound("Product")
    return product
  }

  private async prepareProductWrite(
    user: AuthenticatedUser,
    input: CreateProductInput,
    current?: ProductRecord,
  ): Promise<ProductWrite> {
    const [category, unit] = await Promise.all([
      this.getCategory(user.tenantId, input.categoryId),
      this.getUnit(user.tenantId, input.unitId),
    ])

    if (!category.active && input.categoryId !== current?.categoryId) {
      throw new AppError(409, "CATEGORY_INACTIVE", "An inactive category cannot be assigned.")
    }
    if (!unit.active && input.unitId !== current?.unitId) {
      throw new AppError(409, "UNIT_INACTIVE", "An inactive unit cannot be assigned.")
    }

    const minimumStock = input.type === "service" ? 0 : input.minimumStock ?? 0
    if (!hasValidScale(minimumStock, unit.quantityScale)) {
      throw new AppError(
        400,
        "INVALID_QUANTITY_SCALE",
        `Minimum stock supports at most ${String(unit.quantityScale)} decimal places for this unit.`,
      )
    }

    const costCents = input.costCents ?? null
    const costSource = costCents === null ? null : input.costSource ?? "manual"
    if (
      (costCents === null && input.costSource !== undefined && input.costSource !== null)
      || (costCents !== null && costSource === null)
    ) {
      throw new AppError(
        400,
        "INVALID_COST_SOURCE",
        "Cost source must be present exactly when a cost is present.",
      )
    }

    return {
      sku: nullableIdentifier(input.sku),
      barcode: nullableIdentifier(input.barcode),
      type: input.type,
      name: trimRequired(input.name, "Product name"),
      description: input.description?.trim() ?? "",
      active: input.active ?? true,
      minimumStock,
      priceCents: input.priceCents,
      costCents,
      costSource,
      categoryId: category.id,
      unitId: unit.id,
    }
  }
}
