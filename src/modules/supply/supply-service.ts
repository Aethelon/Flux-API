import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  ProductSupplierWrite,
  SupplierWrite,
  SupplyRepository,
} from "./supply-repository.js"
import type {
  GoodsReceipt,
  ProductSupplier,
  PurchaseOrder,
  Supplier,
  SupplyPage,
} from "./types.js"

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new AppError(400, "REQUIRED_FIELD", `${name} is required.`)
  return normalized
}

function validScale(value: number, scale: number): boolean {
  const factor = 10 ** scale
  return Math.abs(Math.round(value * factor) - (value * factor)) < 1e-8
}

function stale(): AppError {
  return new AppError(409, "STALE_VERSION", "The resource changed. Reload and retry.")
}

interface SupplierInput {
  legalName?: string
  tradeName?: string | null
  taxId?: string | null
  email?: string | null
  phone?: string | null
  contactName?: string | null
  notes?: string
  active?: boolean
}

export class SupplyService {
  constructor(private readonly repository: SupplyRepository) {}

  listSuppliers(tenantId: string, page: number, pageSize: number, search?: string) {
    return this.repository.listSuppliers(tenantId, page, pageSize, search)
  }

  async getSupplier(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.repository.getSupplier(tenantId, id)
    if (!supplier) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier was not found.")
    return supplier
  }

  private supplierWrite(input: SupplierInput, current?: Supplier): SupplierWrite {
    const rawTaxId = input.taxId === undefined ? current?.taxId ?? null : text(input.taxId)
    const taxId = rawTaxId?.replaceAll(/\D/g, "") ?? null
    if (taxId && ![11, 14].includes(taxId.length)) {
      throw new AppError(400, "INVALID_TAX_ID", "Tax ID must contain 11 or 14 digits.")
    }
    return {
      legalName: input.legalName === undefined
        ? current?.legalName ?? ""
        : required(input.legalName, "Supplier legal name"),
      tradeName: input.tradeName === undefined ? current?.tradeName ?? null : text(input.tradeName),
      taxId,
      email: input.email === undefined
        ? current?.email ?? null
        : text(input.email)?.toLowerCase() ?? null,
      phone: input.phone === undefined ? current?.phone ?? null : text(input.phone),
      contactName: input.contactName === undefined
        ? current?.contactName ?? null
        : text(input.contactName),
      notes: input.notes === undefined ? current?.notes ?? "" : input.notes.trim(),
      active: input.active ?? current?.active ?? true,
    }
  }

  createSupplier(
    user: AuthenticatedUser,
    input: SupplierInput & { legalName: string },
    key: string,
  ): Promise<Supplier> {
    const values = this.supplierWrite(input)
    return this.repository.createSupplier(user, values, key, hash(values))
  }

  async updateSupplier(
    user: AuthenticatedUser,
    id: string,
    input: SupplierInput & { version: number },
    key: string,
  ): Promise<Supplier> {
    const current = await this.getSupplier(user.tenantId, id)
    if (current.version !== input.version) throw stale()
    const values = this.supplierWrite(input, current)
    try {
      const result = await this.repository.updateSupplier(
        user, id, input.version, values, current, key, hash({ version: input.version, ...values }),
      )
      if (!result) throw stale()
      return result
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new AppError(409, "DUPLICATE_SUPPLIER_TAX_ID", "Supplier tax ID already exists.")
      }
      throw error
    }
  }

  async listProductSuppliers(
    tenantId: string,
    supplierId: string,
    history: boolean,
  ): Promise<ProductSupplier[]> {
    await this.getSupplier(tenantId, supplierId)
    return this.repository.listProductSuppliers(tenantId, supplierId, history)
  }

  private async relationWrite(
    tenantId: string,
    input: {
      productId: string
      supplierSku?: string | null
      active?: boolean
      leadTimeDays: number
      minimumOrderQuantity: number
      packMultiple: number
    },
  ): Promise<ProductSupplierWrite> {
    const product = await this.repository.getProductMeta(tenantId, input.productId)
    if (!product || !product.active || product.type === "service") {
      throw new AppError(
        409,
        "INVALID_SUPPLIER_PRODUCT",
        "Supplier links require an active stock-managed product.",
      )
    }
    if (
      !validScale(input.minimumOrderQuantity, product.quantityScale)
      || !validScale(input.packMultiple, product.quantityScale)
    ) {
      throw new AppError(
        400,
        "INVALID_QUANTITY_SCALE",
        "Minimum order quantity and pack multiple exceed the product unit precision.",
      )
    }
    return {
      productId: product.id,
      supplierSku: text(input.supplierSku),
      active: input.active ?? true,
      leadTimeDays: input.leadTimeDays,
      minimumOrderQuantity: input.minimumOrderQuantity,
      packMultiple: input.packMultiple,
    }
  }

  async createProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    input: Parameters<SupplyService["relationWrite"]>[1],
    key: string,
  ): Promise<ProductSupplier> {
    const supplier = await this.getSupplier(user.tenantId, supplierId)
    if (!supplier.active) throw new AppError(409, "SUPPLIER_INACTIVE", "Supplier is inactive.")
    const values = await this.relationWrite(user.tenantId, input)
    try {
      return await this.repository.createProductSupplier(
        user, supplierId, values, key, hash(values),
      )
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new AppError(409, "PRODUCT_SUPPLIER_EXISTS", "Current product link already exists.")
      }
      throw error
    }
  }

  async replaceProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    input: Parameters<SupplyService["relationWrite"]>[1],
    key: string,
  ): Promise<ProductSupplier> {
    const current = await this.repository.getProductSupplier(
      user.tenantId, supplierId, relationId,
    )
    if (!current || current.validUntil) {
      throw new AppError(404, "PRODUCT_SUPPLIER_NOT_FOUND", "Current product link was not found.")
    }
    if (input.productId !== current.product.id) {
      throw new AppError(409, "SUPPLIER_PRODUCT_IMMUTABLE", "Linked product cannot be changed.")
    }
    const values = await this.relationWrite(user.tenantId, input)
    const result = await this.repository.replaceProductSupplier(
      user, supplierId, relationId, values, key, hash(values),
    )
    if (!result) throw stale()
    return result
  }

  async closeProductSupplier(
    user: AuthenticatedUser,
    supplierId: string,
    relationId: string,
    key: string,
  ): Promise<void> {
    if (!await this.repository.closeProductSupplier(
      user, supplierId, relationId, key, hash({ relationId }),
    )) throw new AppError(404, "PRODUCT_SUPPLIER_NOT_FOUND", "Current product link was not found.")
  }

  async createPurchaseOrder(
    user: AuthenticatedUser,
    input: {
      supplierId: string
      expectedAt?: string | null
      notes?: string
      items: Array<{ productId: string; quantity: number; agreedUnitCostCents: number }>
    },
    key: string,
  ): Promise<PurchaseOrder> {
    const supplier = await this.getSupplier(user.tenantId, input.supplierId)
    if (!supplier.active) throw new AppError(409, "SUPPLIER_INACTIVE", "Supplier is inactive.")
    const unique = new Map(input.items.map((item) => [item.productId, item]))
    if (unique.size !== input.items.length) {
      throw new AppError(400, "DUPLICATE_PURCHASE_PRODUCT", "Products must be unique in an order.")
    }
    const relations = await this.repository.findCurrentProductSuppliers(
      user.tenantId, input.supplierId, [...unique.keys()],
    )
    if (relations.length !== unique.size) {
      throw new AppError(
        409,
        "SUPPLIER_PRODUCT_NOT_CONFIGURED",
        "Every ordered product needs an active supplier configuration.",
      )
    }
    const items = relations.map((relation) => {
      const item = unique.get(relation.product.id)
      if (!item) throw new Error("Validated purchase item disappeared")
      if (!Number.isSafeInteger(item.agreedUnitCostCents) || item.agreedUnitCostCents < 0) {
        throw new AppError(400, "INVALID_UNIT_COST", "Agreed unit cost is invalid.")
      }
      if (
        item.quantity < relation.minimumOrderQuantity
        || Math.abs((item.quantity / relation.packMultiple)
          - Math.round(item.quantity / relation.packMultiple)) > 1e-8
        || !validScale(item.quantity, relation.product.quantityScale)
      ) {
        throw new AppError(
          400,
          "INVALID_PURCHASE_QUANTITY",
          "Quantity must satisfy unit precision, minimum order, and pack multiple.",
          { productId: item.productId },
        )
      }
      return {
        productId: relation.product.id,
        productName: relation.product.name,
        unitAbbreviation: relation.product.unitAbbreviation,
        quantity: item.quantity,
        agreedUnitCostCents: item.agreedUnitCostCents,
        supplierSku: relation.supplierSku,
        packMultiple: relation.packMultiple,
        minimumOrderQuantity: relation.minimumOrderQuantity,
      }
    }).sort((left, right) => left.productId.localeCompare(right.productId))
    const values = {
      supplierId: supplier.id,
      expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
      notes: input.notes?.trim() ?? "",
      items,
    }
    return this.repository.createPurchaseOrder(user, values, key, hash(values))
  }

  async getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.repository.getPurchaseOrder(tenantId, id)
    if (!order) throw new AppError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.")
    return order
  }

  listPurchaseOrders(tenantId: string, page: number, pageSize: number):
    Promise<SupplyPage<PurchaseOrder>> {
    return this.repository.listPurchaseOrders(tenantId, page, pageSize)
  }

  async submitPurchaseOrder(
    user: AuthenticatedUser,
    id: string,
    version: number,
    key: string,
  ): Promise<PurchaseOrder> {
    const order = await this.repository.submitPurchaseOrder(
      user, id, version, key, hash({ version }),
    )
    if (!order) throw stale()
    return order
  }

  async cancelPurchaseOrder(
    user: AuthenticatedUser,
    id: string,
    version: number,
    reason: string,
    key: string,
  ): Promise<PurchaseOrder> {
    const normalizedReason = required(reason, "Cancellation reason")
    const order = await this.repository.cancelPurchaseOrder(
      user, id, version, normalizedReason, key, hash({ version, reason: normalizedReason }),
    )
    if (!order) throw stale()
    return order
  }

  createGoodsReceipt(
    user: AuthenticatedUser,
    input: {
      purchaseOrderId: string
      supplierDocumentReference?: string | null
      items: Array<{
        purchaseOrderItemId: string
        quantity: number
        acceptedUnitCostCents: number
        lotReference?: string | null
      }>
    },
    key: string,
  ): Promise<GoodsReceipt> {
    const normalized = {
      purchaseOrderId: input.purchaseOrderId,
      supplierDocumentReference: text(input.supplierDocumentReference),
      items: input.items.map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        quantity: item.quantity,
        acceptedUnitCostCents: item.acceptedUnitCostCents,
        lotReference: text(item.lotReference),
      })).sort((left, right) =>
        left.purchaseOrderItemId.localeCompare(right.purchaseOrderItemId)),
    }
    return this.repository.createGoodsReceipt(user, normalized, key, hash(normalized))
  }

  async getGoodsReceipt(tenantId: string, id: string): Promise<GoodsReceipt> {
    const receipt = await this.repository.getGoodsReceipt(tenantId, id)
    if (!receipt) throw new AppError(404, "GOODS_RECEIPT_NOT_FOUND", "Goods receipt not found.")
    return receipt
  }

  reverseGoodsReceipt(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    key: string,
  ): Promise<GoodsReceipt> {
    const normalizedReason = required(reason, "Reversal reason")
    return this.repository.reverseGoodsReceipt(
      user,
      id,
      normalizedReason,
      key,
      hash({ reason: normalizedReason }),
    )
  }
}
