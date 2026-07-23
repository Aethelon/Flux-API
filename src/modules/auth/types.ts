import type { UserRole } from "../../database/types.js"

export interface AuthenticatedUser {
  id: string
  tenantId: string
  sessionId: string
  name: string
  email: string
  role: UserRole
}

export interface PublicUser {
  id: string
  tenantId: string
  name: string
  email: string
  role: UserRole
}

export interface SessionMetadata {
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}

export interface LoginInput {
  email: string
  password: string
  tenantSlug?: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: number
  user: PublicUser
}
