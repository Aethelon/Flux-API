import type { UserRole } from "../../database/types.js"

export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string
  status: "active" | "inactive"
  consentAt: string | null
  anonymizedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface Employee {
  id: string
  name: string
  email: string
  phone: string | null
  role: UserRole
  status: "active" | "inactive"
  version: number
  createdAt: string
  updatedAt: string
}

export interface Page<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
}

export interface PeopleFilters {
  page: number
  pageSize: number
  search?: string
  status?: "active" | "inactive"
}

export interface CreateCustomerInput {
  name: string
  email?: string | null
  phone?: string | null
  notes?: string
  status?: "active" | "inactive"
  consentAt?: string | null
}

export interface UpdateCustomerInput {
  version: number
  name?: string
  email?: string | null
  phone?: string | null
  notes?: string
  status?: "active" | "inactive"
  consentAt?: string | null
}

export interface CreateEmployeeInput {
  name: string
  email: string
  phone?: string | null
  role: UserRole
  status?: "active" | "inactive"
  password: string
}

export interface UpdateEmployeeInput {
  version: number
  name?: string
  email?: string
  phone?: string | null
  role?: UserRole
  status?: "active" | "inactive"
  password?: string
}
