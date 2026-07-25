const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "secret",
  "cookie",
  "cardnumber",
  "securitycode",
  "cvc",
  "cvv",
  "magneticstripe",
])

function normalizedKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

export function redactAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditPayload)
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    SENSITIVE_KEYS.has(normalizedKey(key))
      ? "[REDACTED]"
      : redactAuditPayload(nested),
  ]))
}
