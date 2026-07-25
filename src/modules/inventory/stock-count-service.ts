import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { StockCountRepository } from "./stock-count-repository.js"
import type {
  CancelStockCountInput,
  ConfirmStockCountInput,
  CreateStockCountInput,
  StockCount,
  StockCountFilters,
  StockCountList,
} from "./types.js"

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function requiredReason(reason: string): string {
  const normalized = reason.trim()
  if (normalized.length < 3) {
    throw new AppError(
      400,
      "STOCK_COUNT_REASON_REQUIRED",
      "A stock-count reason with at least three characters is required.",
    )
  }
  return normalized
}

export class StockCountService {
  constructor(private readonly repository: StockCountRepository) {}

  list(tenantId: string, filters: StockCountFilters): Promise<StockCountList> {
    return this.repository.list(tenantId, filters)
  }

  async get(tenantId: string, countId: string): Promise<StockCount> {
    const count = await this.repository.get(tenantId, countId)
    if (!count) {
      throw new AppError(404, "STOCK_COUNT_NOT_FOUND", "Stock count was not found.")
    }
    return count
  }

  create(
    user: AuthenticatedUser,
    input: CreateStockCountInput,
    idempotencyKey: string,
  ): Promise<StockCount> {
    const normalized: CreateStockCountInput = {
      reason: requiredReason(input.reason),
      productIds: [...input.productIds].sort(),
    }
    if (new Set(normalized.productIds).size !== normalized.productIds.length) {
      throw new AppError(
        400,
        "DUPLICATE_COUNT_PRODUCT",
        "A product can appear only once in a stock count.",
      )
    }

    return this.repository.create(
      user,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }

  confirm(
    user: AuthenticatedUser,
    countId: string,
    input: ConfirmStockCountInput,
    idempotencyKey: string,
  ): Promise<StockCount> {
    const normalized: ConfirmStockCountInput = {
      version: input.version,
      items: [...input.items]
        .map((item) => ({
          productId: item.productId,
          countedQuantity: item.countedQuantity,
          ...(item.unitCostCents === undefined
            ? {}
            : { unitCostCents: item.unitCostCents }),
        }))
        .sort((left, right) => left.productId.localeCompare(right.productId)),
    }

    return this.repository.confirm(
      user,
      countId,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }

  cancel(
    user: AuthenticatedUser,
    countId: string,
    input: CancelStockCountInput,
    idempotencyKey: string,
  ): Promise<StockCount> {
    const normalized: CancelStockCountInput = {
      version: input.version,
      reason: requiredReason(input.reason),
    }
    return this.repository.cancel(
      user,
      countId,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }
}
