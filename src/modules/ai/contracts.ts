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
  "The input context.reportPeriod defines the report scope: monthly means only the current calendar month; quarterly means only the current three-calendar-month window. Never cite facts outside that supplied period.",
  "Use only the supplied sanitized metrics and their exact values.",
  "Every statement must cite one or more supplied metric IDs.",
  "Copy sourceMetricIds exactly from input.metrics[].id; never cite forecast or recommendation IDs.",
  "Use entityName and productName whenever supplied; do not refer to named products as generic items.",
  "Monthly series use parallel months and value arrays, where values at the same index belong together.",
  "Copy netRevenueBrl and pointEstimateDisplay literally when discussing money; never present raw cent values as reais.",
  "State the analyzed period, exact relevant values, named products, observed direction, and known limitation.",
  "Do not use vague phrases such as valores expressivos, determinados itens, revisão detalhada, or múltiplos períodos when the input supplies the specific fact.",
  "Do not infer missing facts, calculate unsupported percentages, or invent numeric claims.",
  "Do not mention customers, employees, personal data, or claim that an operational action was executed.",
  "Write an executive summary of four to six concise sentences that explains performance, comparisons, operational impact, and the most important limitation.",
  "When evidence supports it, provide three to four strengths, three to four risks, and three to four recommendations; prefer fewer items only when the supplied evidence is genuinely insufficient.",
  "For every risk, explain the observed evidence and its practical business consequence without inventing a cause.",
  "Write every recommendation as a prioritized action using this structure: 'Prioridade alta, média ou baixa — Ação: ... Motivo: ... Indicador a acompanhar: ...'. Do not invent a target value when the evidence does not supply one.",
  "Prioritize input.recommendations when writing recommendations, naming the product and using its supplied proposedValue and evidenceMetrics.",
  "Each recommendation must connect a named issue to a concrete review or decision, without inventing quantities or discounts.",
  "Recommendations are non-binding and must always require human review before any operational action.",
  "Return only the structured output required by the JSON schema.",
].join(" ")
