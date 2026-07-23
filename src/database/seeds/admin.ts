import { loadConfig } from "../../config/env.js"
import { hashPassword } from "../../modules/auth/password.js"
import { createDatabase } from "../client.js"

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const tenantName = process.env.SEED_TENANT_NAME?.trim() || "D'lara"
const tenantSlug = process.env.SEED_TENANT_SLUG?.trim() || "dlara"
const adminName = required("SEED_ADMIN_NAME")
const adminEmail = required("SEED_ADMIN_EMAIL").toLowerCase()
const adminPassword = required("SEED_ADMIN_PASSWORD")

if (adminPassword.length < 12 || adminPassword.length > 128) {
  throw new Error("SEED_ADMIN_PASSWORD must contain between 12 and 128 characters")
}

const database = createDatabase(loadConfig())

try {
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("tenants")
      .values({
        slug: tenantSlug,
        name: tenantName,
        status: "active",
        archived_at: null,
      })
      .onConflict((conflict) => conflict.column("slug").doNothing())
      .execute()

    const tenant = await transaction
      .selectFrom("tenants")
      .select(["id"])
      .where("slug", "=", tenantSlug)
      .executeTakeFirstOrThrow()

    await transaction
      .insertInto("tenant_settings")
      .values({
        tenant_id: tenant.id,
        timezone: "America/Recife",
        currency: "BRL",
      })
      .onConflict((conflict) => conflict.column("tenant_id").doNothing())
      .execute()

    const existing = await transaction
      .selectFrom("users")
      .select("id")
      .where("tenant_id", "=", tenant.id)
      .where((expression) => expression(
        expression.fn("lower", ["email"]),
        "=",
        adminEmail,
      ))
      .where("archived_at", "is", null)
      .executeTakeFirst()

    if (existing) {
      console.info("The D'lara administrator already exists; no password was changed.")
      return
    }

    const user = await transaction
      .insertInto("users")
      .values({
        tenant_id: tenant.id,
        name: adminName,
        email: adminEmail,
        phone: null,
        password_hash: await hashPassword(adminPassword),
        role: "admin",
        status: "active",
        archived_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow()

    await transaction
      .insertInto("audit_events")
      .values({
        tenant_id: tenant.id,
        actor_type: "system",
        actor_id: null,
        action: "user.seeded",
        entity_type: "user",
        entity_id: user.id,
        request_id: null,
        correlation_id: null,
        source: "system",
        reason: "Initial D'lara administrator",
        before_json: null,
        after_json: {
          name: adminName,
          email: adminEmail,
          role: "admin",
        },
        ip_address: null,
        user_agent: null,
      })
      .execute()

    console.info("The D'lara administrator was created.")
  })
} finally {
  await database.destroy()
}
