import { sql, type Kysely } from "kysely"
import type { Database, UserRole } from "../../database/types.js"
import type { PublicUser, SessionMetadata } from "./types.js"

export interface LoginUserRecord extends PublicUser {
  passwordHash: string
}

export interface RefreshSessionRecord extends PublicUser {
  sessionId: string
  familyId: string
  expiresAt: Date
  revokedAt: Date | null
}

export interface CreateSessionInput {
  tenantId: string
  userId: string
  familyId: string
  refreshTokenHash: string
  expiresAt: Date
  metadata: SessionMetadata
}

export interface RotateSessionInput extends CreateSessionInput {
  currentSessionId: string
  newSessionId: string
}

export interface AuthRepository {
  findLoginCandidates(email: string, tenantSlug?: string): Promise<LoginUserRecord[]>
  recordFailedLogin(user: PublicUser, metadata: SessionMetadata): Promise<void>
  createSession(input: CreateSessionInput): Promise<string>
  findSessionByRefreshHash(refreshTokenHash: string): Promise<RefreshSessionRecord | null>
  rotateSession(input: RotateSessionInput): Promise<boolean>
  revokeSession(sessionId: string, reason: string, requestId: string | null): Promise<void>
  revokeFamily(
    familyId: string,
    tenantId: string,
    userId: string,
    reason: string,
    requestId: string | null,
  ): Promise<void>
  findAuthenticatedUser(
    userId: string,
    tenantId: string,
    sessionId: string,
  ): Promise<AuthenticatedRecord | null>
}

export interface AuthenticatedRecord extends PublicUser {
  sessionId: string
}

interface LoginCandidateRow {
  id: string
  tenant_id: string
  name: string
  email: string
  role: UserRole
  password_hash: string
}

interface SessionRow extends LoginCandidateRow {
  session_id: string
  family_id: string
  expires_at: Date
  revoked_at: Date | null
}

function publicUser(row: LoginCandidateRow): PublicUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    role: row.role,
  }
}

function auditLogin(
  database: Kysely<Database>,
  user: { tenantId: string; userId: string },
  sessionId: string,
  action: string,
  metadata: SessionMetadata,
) {
  return database
    .insertInto("audit_events")
    .values({
      tenant_id: user.tenantId,
      actor_type: "user",
      actor_id: user.userId,
      action,
      entity_type: "auth_session",
      entity_id: sessionId,
      request_id: metadata.requestId,
      correlation_id: metadata.requestId,
      source: "api",
      reason: null,
      before_json: null,
      after_json: null,
      ip_address: metadata.ipAddress,
      user_agent: metadata.userAgent,
    })
    .execute()
}

class RotationConflictError extends Error {}

export class KyselyAuthRepository implements AuthRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async findLoginCandidates(email: string, tenantSlug?: string): Promise<LoginUserRecord[]> {
    let query = this.database
      .selectFrom("users as user")
      .innerJoin("tenants as tenant", "tenant.id", "user.tenant_id")
      .select([
        "user.id",
        "user.tenant_id",
        "user.name",
        "user.email",
        "user.role",
        "user.password_hash",
      ])
      .where(sql<string>`lower("user"."email")`, "=", email.toLowerCase())
      .where("user.status", "=", "active")
      .where("user.archived_at", "is", null)
      .where("tenant.status", "=", "active")
      .where("tenant.archived_at", "is", null)
      .limit(2)

    if (tenantSlug) {
      query = query.where("tenant.slug", "=", tenantSlug)
    }

    const rows = await query.execute() as LoginCandidateRow[]

    return rows.map((row) => ({
      ...publicUser(row),
      passwordHash: row.password_hash,
    }))
  }

  async recordFailedLogin(user: PublicUser, metadata: SessionMetadata): Promise<void> {
    await this.database.insertInto("audit_events").values({
      tenant_id: user.tenantId,
      actor_type: "user",
      actor_id: user.id,
      action: "auth.login_failed",
      entity_type: "user",
      entity_id: user.id,
      request_id: metadata.requestId,
      correlation_id: metadata.requestId,
      source: "api",
      reason: "invalid_credentials",
      before_json: null,
      after_json: null,
      ip_address: metadata.ipAddress,
      user_agent: metadata.userAgent,
    }).execute()
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto("auth_sessions")
        .values({
          tenant_id: input.tenantId,
          user_id: input.userId,
          family_id: input.familyId,
          refresh_token_hash: input.refreshTokenHash,
          user_agent: input.metadata.userAgent,
          ip_address: input.metadata.ipAddress,
          expires_at: input.expiresAt,
          last_used_at: null,
          revoked_at: null,
          revoke_reason: null,
          replaced_by_session_id: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow()

      await auditLogin(
        transaction,
        { tenantId: input.tenantId, userId: input.userId },
        row.id,
        "auth.login_succeeded",
        input.metadata,
      )

      return row.id
    })
  }

  async findSessionByRefreshHash(refreshTokenHash: string): Promise<RefreshSessionRecord | null> {
    const row = await this.database
      .selectFrom("auth_sessions as session")
      .innerJoin("users as user", "user.id", "session.user_id")
      .innerJoin("tenants as tenant", "tenant.id", "session.tenant_id")
      .select([
        "user.id",
        "user.tenant_id",
        "user.name",
        "user.email",
        "user.role",
        "user.password_hash",
        "session.id as session_id",
        "session.family_id",
        "session.expires_at",
        "session.revoked_at",
      ])
      .where("session.refresh_token_hash", "=", refreshTokenHash)
      .where("user.status", "=", "active")
      .where("user.archived_at", "is", null)
      .where("tenant.status", "=", "active")
      .where("tenant.archived_at", "is", null)
      .executeTakeFirst() as SessionRow | undefined

    if (!row) return null

    return {
      ...publicUser(row),
      sessionId: row.session_id,
      familyId: row.family_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }
  }

  async rotateSession(input: RotateSessionInput): Promise<boolean> {
    try {
      await this.database.transaction().execute(async (transaction) => {
        const update = await transaction
          .updateTable("auth_sessions")
          .set({
            revoked_at: new Date(),
            revoke_reason: "rotated",
            last_used_at: new Date(),
          })
          .where("id", "=", input.currentSessionId)
          .where("revoked_at", "is", null)
          .executeTakeFirst()

        if (update.numUpdatedRows !== 1n) {
          throw new RotationConflictError()
        }

        await transaction
          .insertInto("auth_sessions")
          .values({
            id: input.newSessionId,
            tenant_id: input.tenantId,
            user_id: input.userId,
            family_id: input.familyId,
            refresh_token_hash: input.refreshTokenHash,
            user_agent: input.metadata.userAgent,
            ip_address: input.metadata.ipAddress,
            expires_at: input.expiresAt,
            last_used_at: null,
            revoked_at: null,
            revoke_reason: null,
            replaced_by_session_id: null,
          })
          .execute()

        await transaction
          .updateTable("auth_sessions")
          .set({ replaced_by_session_id: input.newSessionId })
          .where("id", "=", input.currentSessionId)
          .execute()

        await auditLogin(
          transaction,
          { tenantId: input.tenantId, userId: input.userId },
          input.newSessionId,
          "auth.session_rotated",
          input.metadata,
        )
      })

      return true
    } catch (error) {
      if (error instanceof RotationConflictError) {
        return false
      }
      throw error
    }
  }

  async revokeSession(sessionId: string, reason: string, requestId: string | null): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom("auth_sessions")
        .select(["tenant_id", "user_id"])
        .where("id", "=", sessionId)
        .executeTakeFirst()

      if (!session) return

      await transaction
        .updateTable("auth_sessions")
        .set({
          revoked_at: new Date(),
          revoke_reason: reason,
        })
        .where("id", "=", sessionId)
        .where("revoked_at", "is", null)
        .execute()

      await auditLogin(
        transaction,
        { tenantId: session.tenant_id, userId: session.user_id },
        sessionId,
        "auth.session_revoked",
        {
          ipAddress: null,
          userAgent: null,
          requestId,
        },
      )
    })
  }

  async revokeFamily(
    familyId: string,
    tenantId: string,
    userId: string,
    reason: string,
    requestId: string | null,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("auth_sessions")
        .set({
          revoked_at: new Date(),
          revoke_reason: reason,
        })
        .where("family_id", "=", familyId)
        .where("revoked_at", "is", null)
        .execute()

      await auditLogin(
        transaction,
        { tenantId, userId },
        familyId,
        "auth.session_family_revoked",
        {
          ipAddress: null,
          userAgent: null,
          requestId,
        },
      )
    })
  }

  async findAuthenticatedUser(
    userId: string,
    tenantId: string,
    sessionId: string,
  ): Promise<AuthenticatedRecord | null> {
    const row = await this.database
      .selectFrom("auth_sessions as session")
      .innerJoin("users as user", "user.id", "session.user_id")
      .innerJoin("tenants as tenant", "tenant.id", "session.tenant_id")
      .select([
        "user.id",
        "user.tenant_id",
        "user.name",
        "user.email",
        "user.role",
        "session.id as session_id",
      ])
      .where("user.id", "=", userId)
      .where("user.tenant_id", "=", tenantId)
      .where("session.id", "=", sessionId)
      .where("session.revoked_at", "is", null)
      .where("session.expires_at", ">", new Date())
      .where("user.status", "=", "active")
      .where("user.archived_at", "is", null)
      .where("tenant.status", "=", "active")
      .where("tenant.archived_at", "is", null)
      .executeTakeFirst()

    if (!row) return null

    return {
      id: row.id,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      name: row.name,
      email: row.email,
      role: row.role,
    }
  }
}
