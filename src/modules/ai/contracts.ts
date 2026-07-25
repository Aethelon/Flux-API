export const AI_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", maxLength: 1000 },
        sourceMetricIds: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { type: "string" },
        },
      },
      required: ["text", "sourceMetricIds"],
    },
    strengths: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", maxLength: 500 },
          sourceMetricIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" },
          },
        },
        required: ["text", "sourceMetricIds"],
      },
    },
    risks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          text: { type: "string", maxLength: 500 },
          sourceMetricIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" },
          },
        },
        required: ["severity", "text", "sourceMetricIds"],
      },
    },
    recommendations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", maxLength: 500 },
          sourceMetricIds: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" },
          },
          requiresHumanReview: { type: "boolean", enum: [true] },
        },
        required: ["text", "sourceMetricIds", "requiresHumanReview"],
      },
    },
  },
  required: ["summary", "strengths", "risks", "recommendations"],
} as const

export const AI_SYSTEM_PROMPT = [
  "You explain deterministic retail analytics in Brazilian Portuguese.",
  "Use only the supplied sanitized metrics and their exact values.",
  "Every statement must cite one or more supplied metric IDs.",
  "Do not infer missing facts, recalculate values, or invent numeric claims.",
  "Do not mention customers, employees, personal data, or operational actions.",
  "Recommendations are non-binding and must always require human review.",
  "Return only the structured output required by the JSON schema.",
].join(" ")
