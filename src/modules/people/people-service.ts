import { createHash } from "node:crypto"
import { AppError } from "../../shared/errors/app-error.js"
import { hashPassword } from "../auth/password.js"
import type { AuthenticatedUser } from "../auth/types.js"
import type {
  CustomerWrite,
  EmployeeWrite,
  PeopleRepository,
} from "./people-repository.js"
import type {
  CreateCustomerInput,
  CreateEmployeeInput,
  Customer,
  Employee,
  Page,
  PeopleFilters,
  UpdateCustomerInput,
  UpdateEmployeeInput,
} from "./types.js"

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function trimmed(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new AppError(400, "REQUIRED_FIELD", `${field} is required.`)
  return normalized
}

function stale(): AppError {
  return new AppError(409, "STALE_VERSION", "The resource changed. Reload and retry.")
}

function writeError(error: unknown, code: string, message: string): never {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
  ) {
    throw new AppError(409, code, message)
  }
  throw error
}

export class PeopleService {
  constructor(private readonly repository: PeopleRepository) {}

  listCustomers(tenantId: string, filters: PeopleFilters): Promise<Page<Customer>> {
    return this.repository.listCustomers(tenantId, filters)
  }

  async getCustomer(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.repository.getCustomer(tenantId, id)
    if (!customer) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found.")
    return customer
  }

  async createCustomer(
    user: AuthenticatedUser,
    input: CreateCustomerInput,
    key: string,
  ): Promise<Customer> {
    const values: CustomerWrite = {
      name: required(input.name, "Customer name"),
      email: trimmed(input.email)?.toLowerCase() ?? null,
      phone: required(input.phone, "Customer phone"),
      notes: input.notes?.trim() ?? "",
      status: input.status ?? "active",
      consentAt: input.consentAt ? new Date(input.consentAt) : null,
    }
    try {
      return await this.repository.createCustomer(user, values, key, hash(values))
    } catch (error) {
      writeError(error, "DUPLICATE_CUSTOMER_PHONE", "Customer phone is already in use.")
    }
  }

  async updateCustomer(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCustomerInput,
    key: string,
  ): Promise<Customer> {
    const current = await this.getCustomer(user.tenantId, id)
    if (current.version !== input.version) throw stale()
    const values: CustomerWrite = {
      name: input.name === undefined ? current.name : required(input.name, "Customer name"),
      email: input.email === undefined
        ? current.email
        : trimmed(input.email)?.toLowerCase() ?? null,
      phone: input.phone === undefined
        ? required(current.phone ?? "", "Customer phone")
        : required(input.phone, "Customer phone"),
      notes: input.notes === undefined ? current.notes : input.notes.trim(),
      status: input.status ?? current.status,
      consentAt: input.consentAt === undefined
        ? current.consentAt ? new Date(current.consentAt) : null
        : input.consentAt ? new Date(input.consentAt) : null,
    }
    try {
      const updated = await this.repository.updateCustomer(
        user,
        id,
        input.version,
        values,
        current,
        key,
        hash({ version: input.version, ...values }),
      )
      if (!updated) throw stale()
      return updated
    } catch (error) {
      writeError(error, "DUPLICATE_CUSTOMER_PHONE", "Customer phone is already in use.")
    }
  }

  async archiveCustomer(
    user: AuthenticatedUser,
    id: string,
    version: number,
    key: string,
  ): Promise<void> {
    const current = await this.getCustomer(user.tenantId, id)
    if (current.version !== version) throw stale()
    if (!await this.repository.archiveCustomer(
      user,
      id,
      version,
      current,
      key,
      hash({ version }),
    )) throw stale()
  }

  listEmployees(tenantId: string, filters: PeopleFilters): Promise<Page<Employee>> {
    return this.repository.listEmployees(tenantId, filters)
  }

  async getEmployee(tenantId: string, id: string): Promise<Employee> {
    const employee = await this.repository.getEmployee(tenantId, id)
    if (!employee) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee was not found.")
    return employee
  }

  async createEmployee(
    user: AuthenticatedUser,
    input: CreateEmployeeInput,
    key: string,
  ): Promise<Employee> {
    const normalized = {
      name: required(input.name, "Employee name"),
      email: required(input.email, "Employee email").toLowerCase(),
      phone: trimmed(input.phone),
      role: input.role,
      status: input.status ?? "active",
      passwordFingerprint: hash(input.password),
    }
    try {
      return await this.repository.createEmployee(user, {
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        role: normalized.role,
        status: normalized.status,
        passwordHash: await hashPassword(input.password),
      }, key, hash(normalized))
    } catch (error) {
      writeError(error, "DUPLICATE_EMPLOYEE_EMAIL", "Employee email is already in use.")
    }
  }

  async updateEmployee(
    user: AuthenticatedUser,
    id: string,
    input: UpdateEmployeeInput,
    key: string,
  ): Promise<Employee> {
    const current = await this.getEmployee(user.tenantId, id)
    if (current.version !== input.version) throw stale()
    const nextRole = input.role ?? current.role
    const nextStatus = input.status ?? current.status
    if (id === user.id && (nextRole !== current.role || nextStatus !== "active")) {
      throw new AppError(
        409,
        "SELF_ACCESS_CHANGE_FORBIDDEN",
        "An administrator cannot demote or deactivate their own account.",
      )
    }

    const values: EmployeeWrite = {
      name: input.name === undefined ? current.name : required(input.name, "Employee name"),
      email: input.email === undefined
        ? current.email
        : required(input.email, "Employee email").toLowerCase(),
      phone: input.phone === undefined ? current.phone : trimmed(input.phone),
      role: nextRole,
      status: nextStatus,
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
    }
    const fingerprint = {
      version: input.version,
      name: values.name,
      email: values.email,
      phone: values.phone,
      role: values.role,
      status: values.status,
      passwordFingerprint: input.password ? hash(input.password) : null,
    }
    try {
      const updated = await this.repository.updateEmployee(
        user,
        id,
        input.version,
        values,
        current,
        key,
        hash(fingerprint),
      )
      if (!updated) throw stale()
      return updated
    } catch (error) {
      writeError(error, "DUPLICATE_EMPLOYEE_EMAIL", "Employee email is already in use.")
    }
  }

  async archiveEmployee(
    user: AuthenticatedUser,
    id: string,
    version: number,
    key: string,
  ): Promise<void> {
    if (id === user.id) {
      throw new AppError(409, "SELF_ARCHIVE_FORBIDDEN", "An administrator cannot archive themself.")
    }
    const current = await this.getEmployee(user.tenantId, id)
    if (current.version !== version) throw stale()
    if (!await this.repository.archiveEmployee(
      user,
      id,
      version,
      current,
      key,
      hash({ version }),
    )) throw stale()
  }
}
