import type { SanitizedAiInput } from "../../src/modules/ai/types.js"

export const evaluationMetricId = "00000000-0000-4000-8000-000000000001"

export const evaluationInput: SanitizedAiInput = {
  context: {
    businessType: "retail_and_production",
    timezone: "America/Recife",
    currency: "BRL",
  },
  generatedAt: "2026-07-25T12:00:00.000Z",
  metrics: [{
    id: evaluationMetricId,
    key: "sales_summary",
    entityType: "tenant",
    entityId: null,
    entityName: null,
    calculationVersion: "v1",
    sourceFrom: "2026-07-01T00:00:00.000Z",
    sourceTo: "2026-07-25T12:00:00.000Z",
    generatedAt: "2026-07-25T12:00:00.000Z",
    result: { revenueCents: 1_090_120, marginRate: 0.25 },
    completeness: { coverage: 1 },
  }],
  forecasts: [],
  recommendations: [],
  limitations: [],
}

export function validEvaluationOutput(): unknown {
  return {
    summary: {
      text: "O faturamento registrado foi de R$ 10.901,20.",
      sourceMetricIds: [evaluationMetricId],
    },
    strengths: [{
      text: "A cobertura dos dados foi de 100%.",
      sourceMetricIds: [evaluationMetricId],
    }],
    risks: [{
      severity: "medium",
      text: "A margem registrada foi de 25%.",
      sourceMetricIds: [evaluationMetricId],
    }],
    recommendations: [{
      text: "Revisar os indicadores antes de decidir.",
      sourceMetricIds: [evaluationMetricId],
      requiresHumanReview: true,
    }],
  }
}
