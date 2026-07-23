import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AccessTokenService } from "../src/modules/auth/tokens.js"
import { testConfig } from "./helpers/config.js"

void describe("access tokens", () => {
  void it("round-trips the authenticated server context", async () => {
    const service = new AccessTokenService(testConfig)
    const user = {
      id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
      tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
      name: "D'lara Admin",
      email: "admin@dlara.test",
      role: "admin" as const,
    }
    const sessionId = "483dece1-5925-407c-a830-a1d498862be0"

    const token = await service.sign(user, sessionId)
    const verified = await service.verify(token)

    assert.deepEqual(verified, {
      ...user,
      sessionId,
    })
  })

  void it("rejects a token signed with another secret", async () => {
    const first = new AccessTokenService(testConfig)
    const second = new AccessTokenService({
      ...testConfig,
      jwtAccessSecret: "another-test-secret-with-thirty-two-characters",
    })
    const token = await first.sign(
      {
        id: "0cc5eec0-3ff9-40b0-b7e7-d4305249a550",
        tenantId: "f61dedad-7fc6-478e-8b68-9f3375efb030",
        name: "D'lara Admin",
        email: "admin@dlara.test",
        role: "admin",
      },
      "483dece1-5925-407c-a830-a1d498862be0",
    )

    await assert.rejects(second.verify(token))
  })
})
