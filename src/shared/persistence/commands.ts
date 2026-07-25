import { sql, type Kysely } from "kysely"
import type { Database } from "../../database/types.js"
import type { AuthenticatedUser } from "../../modules/auth/types.js"
import { AppError } from "../errors/app-error.js"

function responseEntityId(response: unknown): string | null {
  return typeof response === "object"
    && response !== null
    && "entityId" in response
    && typeof response.entityId === "string"
    ? response.entityId
    : null
}

export async function replayedEntityId(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  route: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<string | null> {
  const lockKey = `${user.tenantId}:${user.id}:${route}:${idempotencyKey}`
  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `.execute(database)

  await database.deleteFrom("idempotency_records")
    .where("tenant_id", "=", user.tenantId)
    .where("user_id", "=", user.id)
    .where("route", "=", route)
    .where("idempotency_key", "=", idempotencyKey)
    .where("expires_at", "<=", new Date())
    .execute()

  const existing = await database
    .selectFrom("idempotency_records")
    .select(["request_hash", "response_body"])
    .where("tenant_id", "=", user.tenantId)
    .where("user_id", "=", user.id)
    .where("route", "=", route)
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirst()

  if (!existing) return null
  if (existing.request_hash !== requestHash) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "The idempotency key was already used with different request data.",
    )
  }

  const entityId = responseEntityId(existing.response_body)
  if (!entityId) {
    throw new AppError(
      409,
      "IDEMPOTENCY_RESULT_UNAVAILABLE",
      "The previous request result is not available for replay.",
    )
  }
  return entityId
}

export async function saveEntityIdempotency(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  route: string,
  idempotencyKey: string,
  requestHash: string,
  entityId: string,
  responseStatus: number,
): Promise<void> {
  await database.insertInto("idempotency_records").values({
    tenant_id: user.tenantId,
    user_id: user.id,
    route,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    response_status: responseStatus,
    response_body: { entityId },
    expires_at: new Date(Date.now() + (24 * 60 * 60 * 1_000)),
  }).execute()
}

export async function recordDomainEvent(
  database: Kysely<Database>,
  user: AuthenticatedUser,
  input: {
    action: string
    entityType: string
    entityId: string
    reason?: string | null
    before?: unknown
    after?: unknown
    aggregateType?: string
    aggregateId?: string
  },
): Promise<void> {
  await database.insertInto("audit_events").values({
    tenant_id: user.tenantId,
    actor_type: "user",
    actor_id: user.id,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    request_id: null,
    correlation_id: null,
    source: "api",
    reason: input.reason ?? null,
    before_json: input.before ?? null,
    after_json: input.after ?? null,
    ip_address: null,
    user_agent: null,
  }).execute()

  await database.insertInto("outbox_events").values({
    tenant_id: user.tenantId,
    event_type: input.action,
    aggregate_type: input.aggregateType ?? input.entityType,
    aggregate_id: input.aggregateId ?? input.entityId,
    payload: input.after ?? { entityId: input.entityId },
    status: "pending",
    last_error: null,
    processed_at: null,
  }).execute()
}
