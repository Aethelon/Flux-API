import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  inputHash,
  validateAiOutput,
} from "../src/modules/ai/validation.js"
import {
  evaluationInput as input,
  validEvaluationOutput as validOutput,
} from "./fixtures/ai-evaluation-v1.js"

void describe("AI semantic validation", () => {
  void it("accepts exact, evidenced numeric claims", () => {
    const result = validateAiOutput(validOutput(), input)
    assert.equal(result.accepted, true)
    assert.equal(result.output?.summary.text, "O faturamento registrado foi de R$ 10.901,20.")
  })

  void it("rejects unknown evidence", () => {
    const output = validOutput() as {
      summary: { text: string; sourceMetricIds: string[] }
    }
    output.summary.sourceMetricIds = ["00000000-0000-4000-8000-000000000099"]
    const result = validateAiOutput(output, input)
    assert.equal(result.accepted, false)
    assert.ok(result.reasons.includes("invalid_summary"))
  })

  void it("rejects numeric claims absent from deterministic input", () => {
    const output = validOutput() as {
      summary: { text: string; sourceMetricIds: string[] }
    }
    output.summary.text = "O faturamento registrado foi de R$ 99.999,00."
    const result = validateAiOutput(output, input)
    assert.equal(result.accepted, false)
    assert.ok(result.reasons.includes("unsupported_numeric_claim:99.999,00"))
  })

  void it("rejects extra properties and recommendations without review", () => {
    const output = validOutput() as {
      recommendations: Array<Record<string, unknown>>
      autonomousAction?: string
    }
    output.autonomousAction = "change-stock"
    const recommendation = output.recommendations[0]
    assert.ok(recommendation)
    recommendation.requiresHumanReview = false
    const result = validateAiOutput(output, input)
    assert.equal(result.accepted, false)
    assert.ok(result.reasons.includes("invalid_root_properties"))
    assert.ok(result.reasons.includes("invalid_recommendation"))
  })

  void it("sanitizes markup and links before persistence", () => {
    const output = validOutput() as {
      summary: { text: string; sourceMetricIds: string[] }
    }
    output.summary.text = "<b>Resultado</b> em https://example.com"
    const result = validateAiOutput(output, input)
    assert.equal(result.accepted, true)
    assert.equal(result.output?.summary.text, "Resultado em [link removed]")
  })

  void it("creates a canonical hash independent of object key order", () => {
    const reordered = {
      ...input,
      context: {
        currency: "BRL",
        timezone: "America/Recife",
        businessType: "retail_and_production" as const,
      },
    }
    assert.equal(inputHash(input), inputHash(reordered))
  })
})
