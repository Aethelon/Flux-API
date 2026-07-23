import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { hashPassword, verifyPassword } from "../src/modules/auth/password.js"

void describe("password hashing", () => {
  void it("verifies the original password without storing it", async () => {
    const password = "a-strong-development-password"
    const encoded = await hashPassword(password)

    assert.equal(encoded.includes(password), false)
    assert.equal(await verifyPassword(password, encoded), true)
    assert.equal(await verifyPassword("wrong-password", encoded), false)
  })

  void it("rejects malformed hashes", async () => {
    assert.equal(await verifyPassword("password", "not-a-valid-hash"), false)
  })
})
