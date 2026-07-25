import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { SalesRepository } from "./sales-repository.js"
import type { CreateReturnInput, CreateSaleInput, Sale, SaleReturn } from "./types.js"

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function requiredReason(value: string): string {
  const reason = value.trim()
  if (reason.length < 3) {
    throw new AppError(400, "REASON_REQUIRED", "A reason with at least three characters is required.")
  }
  return reason
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null
}

export class SalesService {
  constructor(private readonly repository: SalesRepository) {}

  async get(tenantId: string, id: string): Promise<Sale> {
    const sale = await this.repository.get(tenantId, id)
    if (!sale) throw new AppError(404, "SALE_NOT_FOUND", "Sale was not found.")
    return sale
  }

  create(
    user: AuthenticatedUser,
    input: CreateSaleInput,
    idempotencyKey: string,
  ): Promise<Sale> {
    const sourceKeys = input.items.map((item) =>
      "productId" in item ? `product:${item.productId}` : `order:${item.serviceOrderId}`
    )
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      throw new AppError(400, "DUPLICATE_SALE_ITEM", "A sale source can appear only once.")
    }
    for (const payment of input.payments) {
      if (payment.method !== "credit" && payment.installments !== undefined) {
        throw new AppError(
          400,
          "INSTALLMENTS_NOT_ALLOWED",
          "Installments are allowed only for credit payments.",
        )
      }
    }
    const normalized: CreateSaleInput = {
      customerId: input.customerId ?? null,
      discountAmountCents: input.discountAmountCents ?? 0,
      changeAmountCents: input.changeAmountCents ?? 0,
      items: [...input.items].sort((left, right) => {
        const leftKey = "productId" in left ? `product:${left.productId}` : `order:${left.serviceOrderId}`
        const rightKey = "productId" in right
          ? `product:${right.productId}` : `order:${right.serviceOrderId}`
        return leftKey.localeCompare(rightKey)
      }),
      payments: input.payments.map((payment) => ({
        method: payment.method,
        amountCents: payment.amountCents,
        ...(payment.installments === undefined ? {} : { installments: payment.installments }),
        externalReference: optionalText(payment.externalReference),
      })),
    }
    return this.repository.create(user, normalized, idempotencyKey, requestHash(normalized))
  }

  cancel(
    user: AuthenticatedUser,
    saleId: string,
    input: { version: number; reason: string },
    idempotencyKey: string,
  ): Promise<Sale> {
    const normalized = { version: input.version, reason: requiredReason(input.reason) }
    return this.repository.cancel(
      user,
      saleId,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }

  createReturn(
    user: AuthenticatedUser,
    saleId: string,
    input: CreateReturnInput,
    idempotencyKey: string,
  ): Promise<SaleReturn> {
    const itemIds = input.items.map((item) => item.saleItemId)
    if (new Set(itemIds).size !== itemIds.length) {
      throw new AppError(
        400,
        "DUPLICATE_RETURN_ITEM",
        "A sale item can appear only once in a return.",
      )
    }
    const normalized: CreateReturnInput = {
      reason: requiredReason(input.reason),
      items: [...input.items]
        .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId)),
      refunds: input.refunds.map((refund) => ({
        method: refund.method,
        amountCents: refund.amountCents,
        externalReference: optionalText(refund.externalReference),
      })),
    }
    return this.repository.createReturn(
      user,
      saleId,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }
}
