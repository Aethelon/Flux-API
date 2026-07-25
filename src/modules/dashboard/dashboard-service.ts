import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { DashboardRepository } from "./dashboard-repository.js"
import type { Dashboard } from "./types.js"

function optionalDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_DATE_RANGE", `${field} must be a valid timestamp.`)
  }
  return parsed
}

export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  get(
    user: AuthenticatedUser,
    input: {
      from?: string
      to?: string
      bucket?: "day" | "week" | "month"
      topBy?: "units" | "net_revenue"
      topLimit?: string
    },
  ): Promise<Dashboard> {
    const from = optionalDate(input.from, "from")
    const to = optionalDate(input.to, "to")
    if (from && to && from >= to) {
      throw new AppError(400, "INVALID_DATE_RANGE", "from must be earlier than to.")
    }
    return this.repository.get(user.tenantId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      bucket: input.bucket ?? "day",
      topBy: input.topBy ?? "net_revenue",
      topLimit: input.topLimit ? Number(input.topLimit) : 5,
    })
  }
}
