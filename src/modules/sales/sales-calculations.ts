import { AppError } from "../../shared/errors/app-error.js"

interface GrossLine {
  key: string
  grossAmountCents: number
}

export function allocateDiscount(
  lines: GrossLine[],
  discountAmountCents: number,
): Map<string, number> {
  const gross = lines.reduce((sum, line) => sum + line.grossAmountCents, 0)
  if (!Number.isSafeInteger(discountAmountCents)
    || discountAmountCents < 0
    || discountAmountCents > gross) {
    throw new AppError(400, "INVALID_SALE_DISCOUNT", "Discount exceeds the sale gross amount.")
  }
  if (gross === 0) {
    if (discountAmountCents !== 0) {
      throw new AppError(400, "INVALID_SALE_DISCOUNT", "A zero-value sale cannot have a discount.")
    }
    return new Map(lines.map((line) => [line.key, 0]))
  }

  const allocations = new Map(lines.map((line) => [
    line.key,
    Math.floor((discountAmountCents * line.grossAmountCents) / gross),
  ]))
  const allocated = [...allocations.values()].reduce((sum, value) => sum + value, 0)
  const remainder = discountAmountCents - allocated
  if (remainder > 0) {
    const largest = [...lines].sort((left, right) =>
      right.grossAmountCents - left.grossAmountCents
      || left.key.localeCompare(right.key)
    )[0]
    if (largest) allocations.set(largest.key, (allocations.get(largest.key) ?? 0) + remainder)
  }
  return allocations
}

export function quantityMatchesScale(quantity: number, scale: number): boolean {
  const factor = 10 ** scale
  return Math.abs((quantity * factor) - Math.round(quantity * factor)) < 1e-8
}
