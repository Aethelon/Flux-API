import type { PermissionKey } from "../../shared/auth/permissions.js"

export interface JobRole {
  id: string
  name: string
  description: string
  status: "active" | "inactive"
  systemKey: "administrator" | "operator" | null
  permissions: PermissionKey[]
  employeeCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateJobRoleInput {
  name: string
  description?: string
  permissions?: string[]
}

export interface UpdateJobRoleInput {
  version: number
  name?: string
  description?: string
  status?: "active" | "inactive"
  permissions?: string[]
}

