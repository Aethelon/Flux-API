import type { FastifyInstance, FastifyRequest } from "fastify"
import { AppError } from "../../shared/errors/app-error.js"
import type { UserRole } from "../../database/types.js"
import { KyselyAuthRepository } from "./auth-repository.js"
import { AuthService } from "./auth-service.js"
import { authRoutes } from "./routes.js"

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "UNAUTHORIZED", "Missing or invalid bearer token.")
  }

  return authorization.slice(7)
}

export function registerAuthModule(app: FastifyInstance): void {
  const repository = new KyselyAuthRepository(app.db)
  const authService = new AuthService(repository, app.config)

  app.decorate("authService", authService)
  app.decorateRequest("auth", null)
  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.auth = await authService.authenticate(bearerToken(request))
  })
  app.decorate("authorize", (roles: readonly UserRole[]) => async (request: FastifyRequest) => {
    await app.authenticate(request)
    if (!request.auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing authenticated user.")
    }
    authService.assertRole(request.auth, roles)
  })

  void app.register(authRoutes, { prefix: "/api/v1/auth" })
}
