import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  AuthRepository,
  LoginUserRecord,
} from "../src/modules/auth/auth-repository.js"
import { AuthService } from "../src/modules/auth/auth-service.js"
import { hashPassword } from "../src/modules/auth/password.js"
import type { SessionMetadata } from "../src/modules/auth/types.js"
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
})
