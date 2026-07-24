import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { InventoryRepository } from "./inventory-repository.js"
import type {
  BalanceFilters,
  CreateManualMovementInput,
  InventoryBalance,
  InventoryBalanceList,
  MovementFilters,
  StockMovement,
  StockMovementList,
} from "./types.js"

function hasValidScale(value: number, scale: number): boolean {
  const factor = 10 ** scale
  return Math.abs(Math.round(value * factor) - (value * factor)) < 1e-8
}

function decodeCursor(cursor: string): NonNullable<MovementFilters["cursor"]> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      typeof decoded !== "object"
      || decoded === null
      || !("occurredAt" in decoded)
      || !("id" in decoded)
      || typeof decoded.occurredAt !== "string"
      || typeof decoded.id !== "string"
      || Number.isNaN(Date.parse(decoded.occurredAt))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(decoded.id)
    ) {
      throw new Error("Invalid cursor")
    }
    return {
      occurredAt: decoded.occurredAt,
      id: decoded.id,
    }
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "The movement cursor is invalid.")
  }
}

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  listBalances(
    tenantId: string,
    filters: BalanceFilters,
  ): Promise<InventoryBalanceList> {
    return this.repository.listBalances(tenantId, filters)
  }

  async getBalance(tenantId: string, productId: string): Promise<InventoryBalance> {
    const product = await this.repository.getStockProduct(tenantId, productId)
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found.")
    }
    if (product.type === "service") {
      throw new AppError(
        409,
        "SERVICE_HAS_NO_INVENTORY",
        "Services do not have inventory balances.",
      )
    }

    const balance = await this.repository.getBalance(tenantId, productId)
    if (!balance) {
      throw new AppError(404, "INVENTORY_BALANCE_NOT_FOUND", "Inventory balance was not found.")
    }
    return balance
  }

  async listMovements(
    tenantId: string,
    input: {
      limit: number
      productId?: string
      type?: MovementFilters["type"]
      cursor?: string
    },
  ): Promise<StockMovementList> {
    const page = await this.repository.listMovements(tenantId, {
      limit: input.limit,
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.cursor ? { cursor: decodeCursor(input.cursor) } : {}),
    })
    const last = page.data.at(-1)

    return {
      data: page.data,
      nextCursor: page.hasMore && last
        ? Buffer.from(JSON.stringify({
            occurredAt: last.occurredAt,
            id: last.id,
          })).toString("base64url")
        : null,
    }
  }

  async postManualMovement(
    user: AuthenticatedUser,
    input: CreateManualMovementInput,
    idempotencyKey: string,
  ): Promise<StockMovement> {
    const product = await this.repository.getStockProduct(user.tenantId, input.productId)
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found.")
    }
    if (!product.active) {
      throw new AppError(409, "PRODUCT_INACTIVE", "An inactive product cannot receive movements.")
    }
    if (product.type === "service") {
      throw new AppError(
        409,
        "SERVICE_HAS_NO_INVENTORY",
        "Services do not have stock movements.",
      )
    }
    if (!hasValidScale(input.quantity, product.quantityScale)) {
      throw new AppError(
        400,
        "INVALID_QUANTITY_SCALE",
        `Quantity supports at most ${String(product.quantityScale)} decimal places for this unit.`,
      )
    }

    const reason = input.reason.trim()
    if (reason.length < 3) {
      throw new AppError(
        400,
        "MOVEMENT_REASON_REQUIRED",
        "A movement reason with at least three characters is required.",
      )
    }

    if (
      (input.type === "receipt" || input.type === "positive_adjustment")
      && input.unitCostCents === undefined
    ) {
      throw new AppError(
        400,
        "UNIT_COST_REQUIRED",
        "Receipts and positive adjustments require the accepted unit cost.",
      )
    }
    if (input.type === "negative_adjustment" && input.unitCostCents !== undefined) {
      throw new AppError(
        400,
        "UNIT_COST_NOT_ALLOWED",
        "Negative adjustments use the current moving-average cost.",
      )
    }

    const normalizedInput: CreateManualMovementInput = {
      ...input,
      reason,
      ...(input.sourceReference?.trim()
        ? { sourceReference: input.sourceReference.trim() }
        : {}),
    }
    const requestHash = createHash("sha256")
      .update(JSON.stringify({
        productId: normalizedInput.productId,
        type: normalizedInput.type,
        quantity: normalizedInput.quantity,
        unitCostCents: normalizedInput.unitCostCents ?? null,
        sourceReference: normalizedInput.sourceReference ?? null,
        reason: normalizedInput.reason,
      }))
      .digest("hex")
    const movement = await this.repository.postManualMovement(
      user,
      normalizedInput,
      idempotencyKey,
      requestHash,
    )
    if (!movement) {
      throw new AppError(
        409,
        "INSUFFICIENT_STOCK",
        "The movement would reduce on-hand stock below the reserved quantity.",
      )
    }
    return movement
  }
}
