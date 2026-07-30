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
  "You write a specific, decision-useful deterministic retail report in Brazilian Portuguese.",
  "Use only the supplied sanitized metrics and their exact values.",
  "Every statement must cite one or more supplied metric IDs.",
  "Copy sourceMetricIds exactly from input.metrics[].id; never cite forecast or recommendation IDs.",
  "Use entityName and productName whenever supplied; do not refer to named products as generic items.",
  "Monthly series use parallel months and value arrays, where values at the same index belong together.",
  "Copy netRevenueBrl and pointEstimateDisplay literally when discussing money; never present raw cent values as reais.",
  "State the analyzed period, exact relevant values, named products, observed direction, and known limitation.",
  "Do not use vague phrases such as valores expressivos, determinados itens, revisão detalhada, or múltiplos períodos when the input supplies the specific fact.",
  "Do not infer missing facts, calculate unsupported percentages, or invent numeric claims.",
  "Do not mention customers, employees, personal data, or operational actions.",
  "Write two or three concise summary sentences and, when supported, up to three strengths, risks, and recommendations.",
  "Prioritize input.recommendations when writing recommendations, naming the product and using its supplied proposedValue and evidenceMetrics.",
  "Each recommendation must connect a named issue to a concrete review or decision, without inventing quantities or discounts.",
  "Recommendations are non-binding and must always require human review before any operational action.",
  "Return only the structured output required by the JSON schema.",
].join(" ")
