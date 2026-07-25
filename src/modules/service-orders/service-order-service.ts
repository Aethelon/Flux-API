import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  ColumnWrite,
  ServiceOrderRepository,
} from "./service-order-repository.js"
import type {
  CreateServiceOrderInput,
  ServiceOrder,
  UpdateServiceOrderInput,
} from "./types.js"

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new AppError(400, "REQUIRED_FIELD", `${field} is required.`)
  return normalized
}

function reason(value: string): string {
  const normalized = value.trim()
  if (normalized.length < 3) {
    throw new AppError(400, "REASON_REQUIRED", "A reason with at least three characters is required.")
  }
  return normalized
}

function date(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_DUE_DATE", "Due date is invalid.")
  }
  return parsed.toISOString()
}

function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(400, "INVALID_ESTIMATED_VALUE", "Estimated value is invalid.")
  }
  return value
}

export class ServiceOrderService {
  constructor(private readonly repository: ServiceOrderRepository) {}

  listColumns(user: AuthenticatedUser) {
    return this.repository.listColumns(user)
  }

  createColumn(
    user: AuthenticatedUser,
    input: ColumnWrite,
    key: string,
  ) {
    const values: ColumnWrite = {
      label: required(input.label, "Column label"),
      semanticType: input.semanticType,
      colorToken: required(input.colorToken, "Column color"),
      displayPosition: input.displayPosition,
    }
    return this.repository.createColumn(user, values, key, requestHash(values))
  }

  async updateColumn(
    user: AuthenticatedUser,
    id: string,
    input: {
      version: number
      label?: string
      colorToken?: string
      displayPosition?: number
    },
    key: string,
  ) {
    const current = (await this.repository.listColumns(user))
      .find((column) => column.id === id)
    if (!current) throw new AppError(404, "COLUMN_NOT_FOUND", "Column was not found.")
    const values = {
      label: input.label === undefined ? current.label : required(input.label, "Column label"),
      colorToken: input.colorToken === undefined
        ? current.colorToken : required(input.colorToken, "Column color"),
      displayPosition: input.displayPosition ?? current.displayPosition,
    }
    const result = await this.repository.updateColumn(
      user, id, input.version, values, key, requestHash({ version: input.version, ...values }),
    )
    if (!result) throw new AppError(409, "STALE_VERSION", "Column changed. Reload and retry.")
    return result
  }

  async archiveColumn(
    user: AuthenticatedUser,
    id: string,
    input: { version: number; reason: string },
    key: string,
  ): Promise<void> {
    const normalized = { version: input.version, reason: reason(input.reason) }
    const archived = await this.repository.archiveColumn(
      user, id, normalized.version, normalized.reason, key, requestHash(normalized),
    )
    if (!archived) throw new AppError(404, "COLUMN_NOT_FOUND", "Column was not found.")
  }

  list(user: AuthenticatedUser, history: boolean) {
    return this.repository.list(user, history)
  }

  async get(tenantId: string, id: string): Promise<ServiceOrder> {
    const order = await this.repository.get(tenantId, id)
    if (!order) {
      throw new AppError(404, "SERVICE_ORDER_NOT_FOUND", "Service order was not found.")
    }
    return order
  }

  create(
    user: AuthenticatedUser,
    input: CreateServiceOrderInput,
    key: string,
  ) {
    const normalized: CreateServiceOrderInput = {
      customerId: input.customerId,
      ...(input.columnId === undefined ? {} : { columnId: input.columnId }),
      title: required(input.title, "Title"),
      description: input.description?.trim() ?? "",
      priority: input.priority,
      dueAt: date(input.dueAt) ?? null,
      estimatedValueCents: money(input.estimatedValueCents),
      responsibleUserId: input.responsibleUserId ?? null,
    }
    return this.repository.create(user, normalized, key, requestHash(normalized))
  }

  update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateServiceOrderInput,
    key: string,
  ) {
    const normalized: UpdateServiceOrderInput = {
      version: input.version,
      ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
      ...(input.title === undefined ? {} : { title: required(input.title, "Title") }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.dueAt === undefined ? {} : { dueAt: date(input.dueAt) ?? null }),
      ...(input.estimatedValueCents === undefined
        ? {} : { estimatedValueCents: money(input.estimatedValueCents) }),
      ...(input.responsibleUserId === undefined
        ? {} : { responsibleUserId: input.responsibleUserId }),
    }
    return this.repository.update(user, id, normalized, key, requestHash(normalized))
      .then((order) => {
        if (!order) {
          throw new AppError(404, "SERVICE_ORDER_NOT_FOUND", "Service order was not found.")
        }
        return order
      })
  }

  transition(
    user: AuthenticatedUser,
    id: string,
    input: { version: number; columnId: string; reason: string },
    key: string,
  ) {
    const normalized = { ...input, reason: reason(input.reason) }
    return this.repository.transition(user, id, normalized, key, requestHash(normalized))
  }
}
