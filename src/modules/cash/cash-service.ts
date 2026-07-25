import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { PaymentMethod } from "../../database/types.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { CashRepository } from "./cash-repository.js"

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length < 1) throw new AppError(400, "REQUIRED_FIELD", `${name} is required.`)
  return normalized
}

export class CashService {
  constructor(private readonly repository: CashRepository) {}

  listRegisters(tenantId: string) {
    return this.repository.listRegisters(tenantId)
  }

  async getRegister(tenantId: string, id: string) {
    const register = await this.repository.getRegister(tenantId, id)
    if (!register) throw new AppError(404, "CASH_REGISTER_NOT_FOUND", "Register was not found.")
    return register
  }

  createRegister(
    user: AuthenticatedUser,
    input: { code: string; name: string },
    key: string,
  ) {
    const values = {
      code: required(input.code, "Register code").toLowerCase(),
      name: required(input.name, "Register name"),
    }
    return this.repository.createRegister(user, values, key, hash(values))
  }

  async updateRegister(
    user: AuthenticatedUser,
    id: string,
    input: { version: number; code?: string; name?: string; active?: boolean },
    key: string,
  ) {
    const current = await this.getRegister(user.tenantId, id)
    if (current.version !== input.version) {
      throw new AppError(409, "STALE_VERSION", "Register changed. Reload and retry.")
    }
    const values = {
      code: input.code === undefined ? current.code : required(input.code, "Register code").toLowerCase(),
      name: input.name === undefined ? current.name : required(input.name, "Register name"),
      active: input.active ?? current.active,
    }
    const result = await this.repository.updateRegister(
      user, id, input.version, values, key, hash({ version: input.version, ...values }),
    )
    if (!result) throw new AppError(409, "STALE_VERSION", "Register changed. Reload and retry.")
    return result
  }

  listAssignments(tenantId: string, currentOnly: boolean) {
    return this.repository.listAssignments(tenantId, currentOnly)
  }

  async myRegister(user: AuthenticatedUser) {
    const result = await this.repository.getMyRegister(user)
    if (!result) {
      throw new AppError(404, "CASH_REGISTER_NOT_ASSIGNED", "No active register is assigned.")
    }
    return result
  }

  assign(
    user: AuthenticatedUser,
    input: { userId: string; registerId: string; reason: string },
    key: string,
  ) {
    const values = { ...input, reason: required(input.reason, "Assignment reason") }
    return this.repository.assign(user, values, key, hash(values))
  }

  async current(user: AuthenticatedUser) {
    const session = await this.repository.getCurrentSession(user.tenantId, user.id)
    if (!session) throw new AppError(404, "CURRENT_CASH_SESSION_NOT_FOUND", "No open session.")
    return session
  }

  open(user: AuthenticatedUser, openingAmountCents: number, key: string) {
    return this.repository.openSession(
      user, openingAmountCents, key, hash({ openingAmountCents }),
    )
  }

  movement(
    user: AuthenticatedUser,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
  ) {
    const values = { ...input, reason: required(input.reason, "Movement reason") }
    return this.repository.manualMovement(user, values, key, hash(values))
  }

  adminMovement(
    user: AuthenticatedUser,
    sessionId: string,
    input: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
    key: string,
  ) {
    const values = { ...input, reason: required(input.reason, "Movement reason") }
    return this.repository.adminMovement(user, sessionId, values, key, hash(values))
  }

  close(
    user: AuthenticatedUser,
    input: {
      version: number
      countedByMethod: Record<PaymentMethod, number>
      note?: string
    },
    key: string,
  ) {
    const values = {
      version: input.version,
      countedByMethod: input.countedByMethod,
      note: input.note?.trim() || null,
    }
    return this.repository.closeSession(user, values, key, hash(values))
  }

  listSessions(tenantId: string, page: number, pageSize: number) {
    return this.repository.listSessions(tenantId, page, pageSize)
  }
}
