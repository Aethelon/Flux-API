import type { AppConfig } from "../../config/env.js"
import type { AiProviderName } from "../../database/types.js"
import { AI_OUTPUT_JSON_SCHEMA, AI_SYSTEM_PROMPT } from "./contracts.js"
import type {
  AiProvider,
  AiProviderResult,
  SanitizedAiInput,
} from "./types.js"

type Fetch = typeof fetch

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly transient: boolean,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = "AiProviderError"
  }
}

interface ResilientProviderOptions {
  timeoutMs: number
  maxRetries: number
  fetch: Fetch
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function anthropicSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicSchema)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) => {
      if (
        key === "minLength"
        || key === "maxLength"
        || key === "minItems"
        || key === "maxItems"
        || (key === "enum" && Array.isArray(nested) && nested[0] === true)
      ) return []
      return [[key, anthropicSchema(nested)]]
    }),
  )
}

abstract class ResilientProvider implements AiProvider {
  abstract readonly name: AiProviderName
  abstract readonly modelId: string
  private failureCount = 0
  private circuitOpenUntil = 0

  constructor(protected readonly options: ResilientProviderOptions) {}

  protected abstract request(input: SanitizedAiInput): Promise<Response>
  protected abstract parse(
    response: unknown,
    latencyMs: number,
    retryCount: number,
  ): AiProviderResult

  async generate(input: SanitizedAiInput): Promise<AiProviderResult> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new AiProviderError(
        "AI_CIRCUIT_OPEN",
        "AI provider is temporarily unavailable.",
        true,
      )
    }
    let retryCount = 0
    while (retryCount <= this.options.maxRetries) {
      const startedAt = Date.now()
      try {
        const response = await this.request(input)
        if (!response.ok) {
          const transient = response.status === 429 || response.status >= 500
          throw new AiProviderError(
            transient ? "AI_PROVIDER_TRANSIENT_ERROR" : "AI_PROVIDER_REQUEST_REJECTED",
            "AI provider request failed.",
            transient,
            response.status,
          )
        }
        const result = this.parse(
          await response.json(),
          Date.now() - startedAt,
          retryCount,
        )
        this.failureCount = 0
        this.circuitOpenUntil = 0
        return result
      } catch (error) {
        const normalized = error instanceof AiProviderError
          ? error
          : new AiProviderError(
              error instanceof DOMException && error.name === "TimeoutError"
                ? "AI_PROVIDER_TIMEOUT"
                : "AI_PROVIDER_UNAVAILABLE",
              "AI provider is unavailable.",
              true,
            )
        this.failureCount += 1
        if (this.failureCount >= 3) {
          this.circuitOpenUntil = Date.now() + 60_000
        }
        if (!normalized.transient || retryCount >= this.options.maxRetries) {
          throw normalized
        }
        retryCount += 1
        await delay((250 * (2 ** (retryCount - 1))) + Math.floor(Math.random() * 100))
      }
    }
    throw new AiProviderError(
      "AI_PROVIDER_UNAVAILABLE",
      "AI provider is unavailable.",
      true,
    )
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
  }
  responseId?: string
}

export class GeminiProvider extends ResilientProvider {
  readonly name = "gemini" as const

  constructor(
    readonly modelId: string,
    private readonly apiKey: string,
    private readonly maxOutputTokens: number,
    options: ResilientProviderOptions,
  ) {
    super(options)
  }

  protected request(input: SanitizedAiInput): Promise<Response> {
    return this.options.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: AI_SYSTEM_PROMPT }],
          },
          contents: [{
            role: "user",
            parts: [{ text: JSON.stringify(input) }],
          }],
          generationConfig: {
            maxOutputTokens: this.maxOutputTokens,
            responseFormat: {
              text: {
                mimeType: "APPLICATION_JSON",
                schema: AI_OUTPUT_JSON_SCHEMA,
              },
            },
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      },
    )
  }

  protected parse(
    response: unknown,
    latencyMs: number,
    retryCount: number,
  ): AiProviderResult {
    const typed = response as GeminiResponse
    const text = typed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "").join("")
    if (!text) {
      throw new AiProviderError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned no structured output.",
        false,
      )
    }
    try {
      return {
        output: JSON.parse(text) as unknown,
        providerRequestId: typed.responseId ?? null,
        inputTokens: typed.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: typed.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs,
        retryCount,
      }
    } catch {
      throw new AiProviderError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned invalid structured output.",
        false,
      )
    }
  }
}

interface AnthropicResponse {
  id?: string
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

export class AnthropicProvider extends ResilientProvider {
  readonly name = "anthropic" as const

  constructor(
    readonly modelId: string,
    private readonly apiKey: string,
    private readonly maxOutputTokens: number,
    private readonly temperature: number,
    options: ResilientProviderOptions,
  ) {
    super(options)
  }

  protected request(input: SanitizedAiInput): Promise<Response> {
    return this.options.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        model: this.modelId,
        max_tokens: this.maxOutputTokens,
        temperature: this.temperature,
        system: AI_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: JSON.stringify(input),
        }],
        output_config: {
          format: {
            type: "json_schema",
            schema: anthropicSchema(AI_OUTPUT_JSON_SCHEMA),
          },
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
  }

  protected parse(
    response: unknown,
    latencyMs: number,
    retryCount: number,
  ): AiProviderResult {
    const typed = response as AnthropicResponse
    const text = typed.content?.find((item) => item.type === "text")?.text
    if (!text) {
      throw new AiProviderError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned no structured output.",
        false,
      )
    }
    try {
      return {
        output: JSON.parse(text) as unknown,
        providerRequestId: typed.id ?? null,
        inputTokens: typed.usage?.input_tokens ?? 0,
        outputTokens: typed.usage?.output_tokens ?? 0,
        latencyMs,
        retryCount,
      }
    } catch {
      throw new AiProviderError(
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned invalid structured output.",
        false,
      )
    }
  }
}

export function createAiProvider(
  config: AppConfig,
  fetchImplementation: Fetch = fetch,
): AiProvider | null {
  const options = {
    timeoutMs: config.aiTimeoutMs,
    maxRetries: config.aiMaxRetries,
    fetch: fetchImplementation,
  }
  if (config.aiProvider === "gemini" && config.geminiApiKey) {
    return new GeminiProvider(
      config.geminiModelId,
      config.geminiApiKey,
      config.aiMaxOutputTokens,
      options,
    )
  }
  if (config.aiProvider === "anthropic" && config.anthropicApiKey) {
    return new AnthropicProvider(
      config.anthropicModelId,
      config.anthropicApiKey,
      config.aiMaxOutputTokens,
      config.aiTemperature,
      options,
    )
  }
  return null
}

export function estimatedCostMicroUsd(
  provider: AiProviderName,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (provider === "gemini" && modelId === "gemini-3.5-flash-lite") {
    return Math.ceil((inputTokens * 0.3) + (outputTokens * 2.5))
  }
  if (provider === "anthropic" && modelId === "claude-haiku-4-5-20251001") {
    return Math.ceil(inputTokens + (outputTokens * 5))
  }
  return null
}
