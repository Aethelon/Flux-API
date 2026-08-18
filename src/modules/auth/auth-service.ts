import { randomUUID } from "node:crypto"
import type { AppConfig } from "../../config/env.js"
import { AppError } from "../../shared/errors/app-error.js"
import { assertRole } from "../../shared/auth/authorization.js"
import type { UserRole } from "../../database/types.js"
import type { AuthRepository } from "./auth-repository.js"
import { verifyPassword } from "./password.js"
import {
  AccessTokenService,
  generateRefreshToken,
  hashRefreshToken,
} from "./tokens.js"
import type {
  AuthenticatedUser,
  AuthTokens,
  LoginInput,
  PublicUser,
  SessionMetadata,
} from "./types.js"

const DUMMY_PASSWORD_HASH =
  "scrypt$v=1$N=32768$r=8$p=1$RzUIW4LvK3ZX-3WuAwaRZg$gVuv_F0qVC5Bilp8IjfSbZx28Azpup_GmyXXs6O8RLIjWBcy2dn2HSCShGxth5BbY9W-LLsIC8Uv8WfSEooNIA"

function unauthorized(): AppError {
  return new AppError(401, "UNAUTHORIZED", "Autenticação inválida ou expirada.")
}

export class AuthService {
  private readonly accessTokens: AccessTokenService

  constructor(
    private readonly repository: AuthRepository,
    private readonly config: AppConfig,
  ) {
    this.accessTokens = new AccessTokenService(config)
  }

  async login(input: LoginInput, metadata: SessionMetadata): Promise<AuthTokens> {
    const candidates = await this.repository.findLoginCandidates(
      input.email.trim(),
      input.tenantSlug?.trim(),
    )

    if (candidates.length > 1) {
      throw new AppError(400, "TENANT_REQUIRED", "Informe o identificador da empresa.")
    }

    const user = candidates[0]
    const validPassword = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    )
    if (!user || !validPassword) {
      if (user) await this.repository.recordFailedLogin(user, metadata)
      throw new AppError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.")
    }

    const refreshToken = generateRefreshToken()
    const sessionId = await this.repository.createSession({
      tenantId: user.tenantId,
      userId: user.id,
      familyId: randomUUID(),
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: this.refreshExpiry(),
      metadata,
    })
    const publicUser: PublicUser = {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
    }

    return this.tokensFor(publicUser, sessionId, refreshToken)
  }

  async refresh(refreshToken: string, metadata: SessionMetadata): Promise<AuthTokens> {
    const current = await this.repository.findSessionByRefreshHash(
      hashRefreshToken(refreshToken),
    )

    if (!current) throw unauthorized()

    if (current.revokedAt) {
      await this.repository.revokeFamily(
        current.familyId,
        current.tenantId,
        current.id,
        "refresh_token_reuse",
        metadata.requestId,
      )
      throw unauthorized()
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      await this.repository.revokeSession(
        current.sessionId,
        "refresh_token_expired",
        metadata.requestId,
      )
      throw unauthorized()
    }

    const nextRefreshToken = generateRefreshToken()
    const nextSessionId = randomUUID()
    const rotated = await this.repository.rotateSession({
      currentSessionId: current.sessionId,
      newSessionId: nextSessionId,
      tenantId: current.tenantId,
      userId: current.id,
      familyId: current.familyId,
      refreshTokenHash: hashRefreshToken(nextRefreshToken),
      expiresAt: this.refreshExpiry(),
      metadata,
    })

    if (!rotated) {
      await this.repository.revokeFamily(
        current.familyId,
        current.tenantId,
        current.id,
        "concurrent_refresh_reuse",
        metadata.requestId,
      )
      throw unauthorized()
    }

    return this.tokensFor(current, nextSessionId, nextRefreshToken)
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    let claims: AuthenticatedUser

    try {
      claims = await this.accessTokens.verify(accessToken)
    } catch {
      throw unauthorized()
    }

    const current = await this.repository.findAuthenticatedUser(
      claims.id,
      claims.tenantId,
      claims.sessionId,
    )

    if (!current) throw unauthorized()

    return current
  }

  async logout(user: AuthenticatedUser, requestId: string): Promise<void> {
    await this.repository.revokeSession(user.sessionId, "logout", requestId)
  }

  assertRole(user: AuthenticatedUser, roles: readonly UserRole[]): void {
    assertRole(user, roles)
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000)
  }

  private async tokensFor(
    user: PublicUser,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthTokens> {
    return {
      accessToken: await this.accessTokens.sign(user, sessionId),
      refreshToken,
      accessTokenExpiresIn: this.config.jwtAccessTtlSeconds,
      user,
    }
  }
}
