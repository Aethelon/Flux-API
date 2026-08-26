import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  AuthRepository,
  LoginUserRecord,
} from "../src/modules/auth/auth-repository.js"
import { AuthService } from "../src/modules/auth/auth-service.js"
import { hashPassword } from "../src/modules/auth/password.js"
import type { SessionMetadata } from "../src/modules/auth/types.js"
import type { AuthenticatedUser } from "../src/modules/auth/types.js"
import { testConfig } from "./helpers/config.js"

const metadata: SessionMetadata = {
  ipAddress: "127.0.0.1",
  userAgent: "auth-service-test",
  requestId: "auth-service-test",
}

function repository(
  candidates: LoginUserRecord[],
  recordFailedLogin: AuthRepository["recordFailedLogin"],
): AuthRepository {
  return new Proxy({
    findLoginCandidates: () => Promise.resolve(candidates),
    recordFailedLogin,
  }, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target]
      }
      return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
    },
  }) as unknown as AuthRepository
}

void describe("authentication business rules", () => {
  void it("audits a failed login for a known account", async () => {
    const user: LoginUserRecord = {
      id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
      tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
      name: "D'lara Admin",
      email: "admin@dlara.test",
      role: "admin",
      passwordHash: await hashPassword("correct-password"),
    }
    let recorded = false
    const service = new AuthService(repository([user], (failedUser, failedMetadata) => {
      recorded = failedUser.id === user.id && failedMetadata === metadata
      return Promise.resolve()
    }), testConfig)

    await assert.rejects(
      service.login({ email: user.email, password: "wrong-password" }, metadata),
      { statusCode: 401, code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
    )
    assert.equal(recorded, true)
  })

  void it("uses the same credential-verification path for an unknown account", async () => {
    let recorded = false
    const service = new AuthService(repository([], () => {
      recorded = true
      return Promise.resolve()
    }), testConfig)

    await assert.rejects(
      service.login({ email: "unknown@dlara.test", password: "wrong-password" }, metadata),
      { statusCode: 401, code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
    )
    assert.equal(recorded, false)
  })

  void it("verifies the current user's password without creating a new session", async () => {
    const passwordHash = await hashPassword("correct-password")
    const service = new AuthService(new Proxy({
      findPasswordHash: () => Promise.resolve(passwordHash),
    }, {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target]
        return () => Promise.reject(new Error(`Unexpected repository call: ${String(property)}`))
      },
    }) as unknown as AuthRepository, testConfig)
    const user = {
      id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
      tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
      sessionId: "483dece1-5925-407c-a830-a1d498862be0",
      name: "D'lara Admin",
      email: "admin@dlara.test",
      role: "admin",
    } satisfies AuthenticatedUser

    await assert.doesNotReject(service.verifyCurrentPassword(user, "correct-password"))
    await assert.rejects(
      service.verifyCurrentPassword(user, "wrong-password"),
      { statusCode: 401, code: "INVALID_PASSWORD", message: "Senha incorreta." },
    )
  })
})
