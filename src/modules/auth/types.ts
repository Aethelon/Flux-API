import type { UserRole } from "../../database/types.js"
import type { PermissionKey } from "../../shared/auth/permissions.js"

export interface AuthJobRole {
  id: string
  name: string
  systemKey: "administrator" | "operator" | null
}

export interface AuthenticatedUser {
  id: string
  tenantId: string
  sessionId: string
  name: string
  email: string
  role: UserRole
  jobRole?: AuthJobRole
  permissions?: PermissionKey[]
}

export interface PublicUser {
  id: string
  tenantId: string
  name: string
  email: string
  role: UserRole
  jobRole?: AuthJobRole
  permissions?: PermissionKey[]
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
