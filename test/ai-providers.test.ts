import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AiProviderError,
  AnthropicProvider,
  GeminiProvider,
  estimatedCostMicroUsd,
} from "../src/modules/ai/providers.js"
import type { SanitizedAiInput } from "../src/modules/ai/types.js"

const input: SanitizedAiInput = {
  context: {
    businessType: "retail_and_production",
    timezone: "America/Recife",
    currency: "BRL",
    reportPeriod: "quarterly",
  },
  generatedAt: "2026-07-25T12:00:00.000Z",
  metrics: [{
    id: "metric",
    key: "completed_sales",
    entityType: "tenant",
    entityId: null,
    entityName: null,
    calculationVersion: "test-v1",
    sourceFrom: "2026-07-01T00:00:00.000Z",
    sourceTo: "2026-07-25T12:00:00.000Z",
    generatedAt: "2026-07-25T12:00:00.000Z",
    result: { value: 1 },
    completeness: { complete: true },
  }],
  forecasts: [],
  recommendations: [],
  limitations: [],
}
const output = {
  summary: { text: "Resumo", sourceMetricIds: ["metric"] },
  strengths: [],
  risks: [],
  recommendations: [],
}
const geminiOutput = {
  ...output,
  summary: { text: "Resumo", sourceMetricIds: ["M1"] },
}

function body(init: RequestInit | undefined): Record<string, unknown> {
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected a JSON request body")
  }
  return JSON.parse(init.body) as Record<string, unknown>
}

void describe("AI providers", () => {
  void it("uses Gemini structured output without unsupported sampling settings", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const provider = new GeminiProvider(
      "gemini-3.5-flash-lite",
      "secret",
      1_500,
      {
        timeoutMs: 1_000,
        maxRetries: 0,
        fetch: (_url, init) => {
          requestBodies.push(body(init))
          return Promise.resolve(new Response(JSON.stringify({
            responseId: "gemini-request",
            candidates: [{ content: { parts: [{ text: JSON.stringify(geminiOutput) }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }), { status: 200 }))
        },
      },
    )
    const result = await provider.generate(input)
    assert.deepEqual(result.output, output)
    assert.equal(result.providerRequestId, "gemini-request")
    const requestBody = requestBodies[0]
    assert.ok(requestBody)
    const generationConfig = requestBody.generationConfig as Record<string, unknown>
    const responseFormat = generationConfig.responseFormat as Record<string, unknown>
    const textFormat = responseFormat.text as Record<string, unknown>
    assert.equal(textFormat.mimeType, "APPLICATION_JSON")
    const contents = requestBody.contents as Array<{
      parts: Array<{ text: string }>
    }>
    assert.equal(
      (JSON.parse(contents[0]?.parts[0]?.text ?? "{}") as SanitizedAiInput)
        .metrics[0]?.id,
      "M1",
    )
    assert.equal(
      (JSON.parse(contents[0]?.parts[0]?.text ?? "{}") as SanitizedAiInput)
        .context.reportPeriod,
      "quarterly",
    )
    assert.equal(JSON.stringify(textFormat.schema).includes('"enum":["metric"]'), false)
    assert.equal("temperature" in generationConfig, false)
  })

  void it("uses Anthropic structured output and configured temperature", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const provider = new AnthropicProvider(
      "claude-haiku-4-5-20251001",
      "secret",
      1_500,
      0.1,
      {
        timeoutMs: 1_000,
        maxRetries: 0,
        fetch: (_url, init) => {
          requestBodies.push(body(init))
          return Promise.resolve(new Response(JSON.stringify({
            id: "anthropic-request",
            content: [{ type: "text", text: JSON.stringify(output) }],
            usage: { input_tokens: 12, output_tokens: 6 },
          }), { status: 200 }))
        },
      },
    )
    const result = await provider.generate(input)
    assert.deepEqual(result.output, output)
    assert.equal(result.providerRequestId, "anthropic-request")
    const requestBody = requestBodies[0]
    assert.ok(requestBody)
    assert.equal(requestBody.temperature, 0.1)
    assert.ok(requestBody.output_config)
    assert.equal(JSON.stringify(requestBody.output_config).includes("maxLength"), false)
  })

  void it("does not retry permanent provider errors", async () => {
    let requests = 0
    const provider = new GeminiProvider(
      "gemini-3.5-flash-lite",
      "secret",
      1_500,
      {
        timeoutMs: 1_000,
        maxRetries: 2,
        fetch: () => {
          requests += 1
          return Promise.resolve(new Response("invalid", { status: 400 }))
        },
      },
    )
    await assert.rejects(
      provider.generate(input),
      (error) => error instanceof AiProviderError
        && error.code === "AI_PROVIDER_REQUEST_REJECTED",
    )
    assert.equal(requests, 1)
  })

  void it("opens the circuit after repeated provider failures", async () => {
    let requests = 0
    const provider = new GeminiProvider(
      "gemini-3.5-flash-lite",
      "secret",
      1_500,
      {
        timeoutMs: 1_000,
        maxRetries: 0,
        fetch: () => {
          requests += 1
          return Promise.resolve(new Response("unavailable", { status: 503 }))
        },
      },
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(provider.generate(input), AiProviderError)
    }
    await assert.rejects(
      provider.generate(input),
      (error) => error instanceof AiProviderError
        && error.code === "AI_CIRCUIT_OPEN",
    )
    assert.equal(requests, 3)
  })

  void it("calculates known model costs in micro-dollars", () => {
    assert.equal(
      estimatedCostMicroUsd("gemini", "gemini-3.5-flash-lite", 1_000, 500),
      1_550,
    )
    assert.equal(
      estimatedCostMicroUsd("anthropic", "claude-haiku-4-5-20251001", 1_000, 500),
      3_500,
    )
    assert.equal(estimatedCostMicroUsd("gemini", "custom", 1_000, 500), null)
  })
})
