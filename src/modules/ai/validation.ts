import { createHash } from "node:crypto"
import type {
  AiEvidenceText,
  AiRecommendation,
  AiRisk,
  AiStructuredOutput,
  SanitizedAiInput,
} from "./types.js"

export interface ValidationResult {
  accepted: boolean
  output: AiStructuredOutput | null
  reasons: string[]
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index])
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, canonical(object[key])]),
  )
}

export function inputHash(input: SanitizedAiInput): string {
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex")
}

export function redactedOutputDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function sanitizedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const sanitized = value
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replaceAll(/https?:\/\/\S+/g, "[link removed]")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join("")
    .trim()
  return sanitized.length >= 1 && sanitized.length <= maxLength ? sanitized : null
}

function metricIds(
  value: unknown,
  approvedIds: ReadonlySet<string>,
): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null
  const values = value.filter(
    (item): item is string => typeof item === "string" && approvedIds.has(item),
  )
  if (values.length !== value.length) {
    return null
  }
  return [...new Set(values)]
}

function evidenceText(
  value: unknown,
  approvedIds: ReadonlySet<string>,
  maxLength: number,
): AiEvidenceText | null {
  const object = record(value)
  if (!object) return null
  if (!hasExactKeys(object, ["sourceMetricIds", "text"])) return null
  const text = sanitizedText(object.text, maxLength)
  const sourceMetricIds = metricIds(object.sourceMetricIds, approvedIds)
  return text && sourceMetricIds ? { text, sourceMetricIds } : null
}

function numericValues(
  value: unknown,
  values: number[],
  key = "",
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    values.push(value)
    if (/cents$/i.test(key)) values.push(value / 100)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) numericValues(item, values, key)
    return
  }
  const object = record(value)
  if (!object) return
  for (const [key, nested] of Object.entries(object)) {
    if (!/(?:id|hash)$/i.test(key)) numericValues(nested, values, key)
  }
}

function parsedClaim(value: string): { value: number; percent: boolean } | null {
  const percent = value.includes("%")
  let normalized = value.replaceAll(/\s|%/g, "")
  const comma = normalized.lastIndexOf(",")
  const dot = normalized.lastIndexOf(".")
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replaceAll(".", "").replace(",", ".")
      : normalized.replaceAll(",", "")
  } else if (comma >= 0) {
    normalized = normalized.replace(",", ".")
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    normalized = normalized.replaceAll(".", "")
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? { value: parsed, percent } : null
}

function unsupportedNumericClaims(
  output: AiStructuredOutput,
  input: SanitizedAiInput,
): string[] {
  const allowed: number[] = []
  numericValues(input, allowed)
  const texts = [
    output.summary.text,
    ...output.strengths.map((item) => item.text),
    ...output.risks.map((item) => item.text),
    ...output.recommendations.map((item) => item.text),
  ]
  const unsupported = new Set<string>()
  for (const text of texts) {
    for (const match of text.match(/[-+]?\d(?:[\d.,]*\d)?(?:\s*%)?/g) ?? []) {
      const claim = parsedClaim(match)
      if (!claim) continue
      const comparable = claim.percent
        ? [claim.value, claim.value / 100]
        : [claim.value]
      const supported = allowed.some((allowedValue) =>
        comparable.some((candidate) =>
          Math.abs(allowedValue - candidate) <= 1e-6
        )
      )
      if (!supported) unsupported.add(match.trim())
    }
  }
  return [...unsupported]
}

export function validateAiOutput(
  value: unknown,
  input: SanitizedAiInput,
): ValidationResult {
  const reasons: string[] = []
  const object = record(value)
  const approvedIds = new Set(input.metrics.map((metric) => metric.id))
  if (!object) return { accepted: false, output: null, reasons: ["invalid_object"] }
  if (!hasExactKeys(
    object,
    ["recommendations", "risks", "strengths", "summary"],
  )) reasons.push("invalid_root_properties")

  const summary = evidenceText(object.summary, approvedIds, 1000)
  if (!summary) reasons.push("invalid_summary")

  const strengths: AiEvidenceText[] = []
  if (!Array.isArray(object.strengths) || object.strengths.length > 5) {
    reasons.push("invalid_strengths")
  } else {
    for (const value of object.strengths) {
      const item = evidenceText(value, approvedIds, 500)
      if (!item) reasons.push("invalid_strength")
      else strengths.push(item)
    }
  }

  const risks: AiRisk[] = []
  if (!Array.isArray(object.risks) || object.risks.length > 5) {
    reasons.push("invalid_risks")
  } else {
    for (const value of object.risks) {
      const risk = record(value)
      const item = risk && hasExactKeys(
        risk,
        ["severity", "sourceMetricIds", "text"],
      )
        ? evidenceText({
            text: risk.text,
            sourceMetricIds: risk.sourceMetricIds,
          }, approvedIds, 500)
        : null
      const severity = risk?.severity
      if (
        !item
        || (severity !== "low" && severity !== "medium" && severity !== "high")
      ) reasons.push("invalid_risk")
      else risks.push({ ...item, severity })
    }
  }

  const recommendations: AiRecommendation[] = []
  if (!Array.isArray(object.recommendations) || object.recommendations.length > 5) {
    reasons.push("invalid_recommendations")
  } else {
    for (const value of object.recommendations) {
      const recommendation = record(value)
      const item = recommendation && hasExactKeys(
        recommendation,
        ["requiresHumanReview", "sourceMetricIds", "text"],
      )
        ? evidenceText({
            text: recommendation.text,
            sourceMetricIds: recommendation.sourceMetricIds,
          }, approvedIds, 500)
        : null
      if (!item || recommendation?.requiresHumanReview !== true) {
        reasons.push("invalid_recommendation")
      } else {
        recommendations.push({ ...item, requiresHumanReview: true })
      }
    }
  }

  if (!summary || reasons.length > 0) {
    return { accepted: false, output: null, reasons: [...new Set(reasons)] }
  }
  const output = { summary, strengths, risks, recommendations }
  const numericClaims = unsupportedNumericClaims(output, input)
  if (numericClaims.length > 0) {
    return {
      accepted: false,
      output: null,
      reasons: numericClaims.map((claim) => `unsupported_numeric_claim:${claim}`),
    }
  }
  return { accepted: true, output, reasons: [] }
}
