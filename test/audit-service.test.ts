import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { redactAuditPayload } from "../src/modules/audit/redaction.js"

void describe("audit payload redaction", () => {
  void it("redacts prohibited values recursively", () => {
    assert.deepEqual(redactAuditPayload({
      email: "admin@dlara.test",
      passwordHash: "hash",
      nested: {
        refresh_token: "token",
        allowed: "value",
      },
      list: [{ apiKey: "key" }],
    }), {
      email: "admin@dlara.test",
      passwordHash: "[REDACTED]",
      nested: {
        refresh_token: "[REDACTED]",
        allowed: "value",
      },
      list: [{ apiKey: "[REDACTED]" }],
    })
  })
})
