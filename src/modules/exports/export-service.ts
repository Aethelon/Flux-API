import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type { ExportRepository } from "./export-repository.js"
import type { CreateExportInput, ExportArtifact, ExportJob } from "./types.js"

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function normalizedDate(value: string | undefined, field: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_DATE_RANGE", `${field} must be a valid timestamp.`)
  }
  return parsed.toISOString()
}

function assertAccess(user: AuthenticatedUser): void {
  if (user.role === "admin") return
  throw new AppError(404, "EXPORT_NOT_FOUND", "Export was not found.")
}

export class ExportService {
  constructor(private readonly repository: ExportRepository) {}

  create(
    user: AuthenticatedUser,
    input: CreateExportInput,
    idempotencyKey: string,
  ): Promise<ExportJob> {
    if (user.role !== "admin") {
      throw new AppError(403, "FORBIDDEN", "You do not have permission for this export.")
    }
    const from = normalizedDate(input.from, "from")
    const to = normalizedDate(input.to, "to")
    if (from && to && from >= to) {
      throw new AppError(400, "INVALID_DATE_RANGE", "from must be earlier than to.")
    }
    const normalized = {
      ...input,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...("search" in input && typeof input.search === "string" && input.search.trim()
        ? { search: input.search.trim() }
        : {}),
      ...("action" in input && typeof input.action === "string" && input.action.trim()
        ? { action: input.action.trim() }
        : {}),
      ...("entityType" in input
        && typeof input.entityType === "string"
        && input.entityType.trim()
        ? { entityType: input.entityType.trim() }
        : {}),
    } as CreateExportInput
    return this.repository.create(
      user,
      normalized,
      idempotencyKey,
      requestHash(normalized),
    )
  }

  async get(user: AuthenticatedUser, id: string): Promise<ExportJob> {
    const job = await this.repository.get(user.tenantId, id)
    if (!job) throw new AppError(404, "EXPORT_NOT_FOUND", "Export was not found.")
    assertAccess(user)
    return job
  }

  async download(user: AuthenticatedUser, id: string): Promise<ExportArtifact> {
    const job = await this.get(user, id)
    if (job.status === "completed" && !job.downloadReady) {
      throw new AppError(410, "EXPORT_EXPIRED", "Export has expired.")
    }
    if (!job.downloadReady) {
      throw new AppError(409, "EXPORT_NOT_READY", "Export is not ready for download.")
    }
    const artifact = await this.repository.getArtifact(user.tenantId, id)
    if (!artifact) {
      throw new AppError(410, "EXPORT_EXPIRED", "Export has expired.")
    }
    return artifact
  }
}
