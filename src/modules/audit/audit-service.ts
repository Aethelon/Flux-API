import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { AuditRepository } from "./audit-repository.js"
import type { AuditCursor, AuditFilters, AuditPage } from "./types.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decodeCursor(value: string): AuditCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      typeof decoded !== "object"
      || decoded === null
      || !("occurredAt" in decoded)
      || !("id" in decoded)
      || typeof decoded.occurredAt !== "string"
      || typeof decoded.id !== "string"
      || Number.isNaN(Date.parse(decoded.occurredAt))
      || !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("Invalid cursor")
    }
    return { occurredAt: decoded.occurredAt, id: decoded.id }
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "The audit cursor is invalid.")
  }
}

function optionalDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_DATE_RANGE", `${field} must be a valid timestamp.`)
  }
  return parsed
}

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(
    user: AuthenticatedUser,
    input: {
      limit?: string
      cursor?: string
      from?: string
      to?: string
      action?: string
      entityType?: string
      entityId?: string
      actorId?: string
      source?: AuditFilters["source"]
    },
  ): Promise<AuditPage> {
    const from = optionalDate(input.from, "from")
    const to = optionalDate(input.to, "to")
    if (from && to && from >= to) {
      throw new AppError(400, "INVALID_DATE_RANGE", "from must be earlier than to.")
    }
    const result = await this.repository.list(user.tenantId, {
      limit: input.limit ? Number(input.limit) : 50,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(input.cursor ? { cursor: decodeCursor(input.cursor) } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.source ? { source: input.source } : {}),
    })
    const last = result.data.at(-1)
    return {
      data: result.data,
      nextCursor: result.hasMore && last
        ? Buffer.from(JSON.stringify({
            occurredAt: last.occurredAt,
            id: last.id,
          })).toString("base64url")
        : null,
    }
  }
}
