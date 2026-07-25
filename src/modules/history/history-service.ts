import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { HistoryRepository } from "./history-repository.js"
import type {
  HistoryCursor,
  HistoryKpis,
  SaleHistoryFilters,
  SaleHistoryPage,
} from "./types.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decodeCursor(value: string): HistoryCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      typeof decoded !== "object"
      || decoded === null
      || !("completedAt" in decoded)
      || !("id" in decoded)
      || typeof decoded.completedAt !== "string"
      || typeof decoded.id !== "string"
      || Number.isNaN(Date.parse(decoded.completedAt))
      || !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("Invalid cursor")
    }
    return { completedAt: decoded.completedAt, id: decoded.id }
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "The sales-history cursor is invalid.")
  }
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function optionalDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_DATE_RANGE", `${field} must be a valid timestamp.`)
  }
  return parsed
}

function dates(input: { from?: string; to?: string }): { from?: Date; to?: Date } {
  const from = optionalDate(input.from, "from")
  const to = optionalDate(input.to, "to")
  if (from && to && from >= to) {
    throw new AppError(400, "INVALID_DATE_RANGE", "from must be earlier than to.")
  }
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }
}

export class HistoryService {
  constructor(private readonly repository: HistoryRepository) {}

  async listSales(
    user: AuthenticatedUser,
    input: {
      limit?: string
      cursor?: string
      from?: string
      to?: string
      status?: SaleHistoryFilters["status"]
      customerId?: string
      operatorId?: string
      paymentMethod?: SaleHistoryFilters["paymentMethod"]
      search?: string
    },
  ): Promise<SaleHistoryPage> {
    const result = await this.repository.listSales(user.tenantId, {
      limit: input.limit ? Number(input.limit) : 50,
      ...dates(input),
      ...(input.cursor ? { cursor: decodeCursor(input.cursor) } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.operatorId ? { operatorId: input.operatorId } : {}),
      ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      ...(input.search?.trim() ? { search: input.search.trim() } : {}),
    }, user.role === "admin")
    const last = result.data.at(-1)
    return {
      data: result.data,
      nextCursor: result.hasMore && last
        ? encodeCursor({ completedAt: last.completedAt, id: last.id })
        : null,
    }
  }

  getKpis(
    user: AuthenticatedUser,
    input: { from?: string; to?: string },
  ): Promise<HistoryKpis> {
    return this.repository.getKpis(user.tenantId, dates(input))
  }
}
