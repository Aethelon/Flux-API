import { createHash, randomBytes } from "node:crypto"
import { jwtVerify, SignJWT } from "jose"
import type { AppConfig } from "../../config/env.js"
import type { AuthenticatedUser, PublicUser } from "./types.js"

const TOKEN_ISSUER = "flux-api"
const TOKEN_AUDIENCE = "flux-app"

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url")
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export class AccessTokenService {
  private readonly secret: Uint8Array

  constructor(private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.jwtAccessSecret)
  }

  async sign(user: PublicUser, sessionId: string): Promise<string> {
    return new SignJWT({
      tenantId: user.tenantId,
      sessionId,
      name: user.name,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.config.jwtAccessTtlSeconds)
      .sign(this.secret)
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const result = await jwtVerify(token, this.secret, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    })
    const payload = result.payload

    if (
      typeof payload.sub !== "string"
      || typeof payload.tenantId !== "string"
      || typeof payload.sessionId !== "string"
      || typeof payload.name !== "string"
      || typeof payload.email !== "string"
      || (payload.role !== "admin" && payload.role !== "funcionario")
    ) {
      throw new Error("Invalid access-token claims")
    }

    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      name: payload.name,
      email: payload.email,
      role: payload.role,
    }
  }
}
