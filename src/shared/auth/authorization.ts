import type { UserRole } from "../../database/types.js"
import type { AuthenticatedUser } from "../../modules/auth/types.js"
import { AppError } from "../errors/app-error.js"

export function assertRole(
  user: AuthenticatedUser,
  roles: readonly UserRole[],
): void {
  if (!roles.includes(user.role)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission for this resource.")
  }
}
