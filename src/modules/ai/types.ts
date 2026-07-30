import type { AiProviderName, AiRunStatus } from "../../database/types.js"

export interface SanitizedMetric {
  id: string
  key: string
  entityType: string
  entityId: string | null
  entityName: string | null
  calculationVersion: string
  sourceFrom: string
  sourceTo: string
  generatedAt: string
  result: unknown
  completeness: unknown
}

export interface SanitizedForecast {
  id: string
  targetType: "product_demand" | "monthly_revenue"
  productId: string | null
  productName: string | null
  unit: "BRL_CENTS" | "UNITS"
  method: string
  calculationVersion: string
  trainingFrom: string
  trainingTo: string
  modelMetrics: unknown
  baselineMetrics: unknown
  confidenceScore: number | null
  confidenceLabel: string
  limitations: unknown
  sourceMetricIds: string[]
  points: Array<{
    bucketStart: string
    horizon: number
    pointEstimate: number
    pointEstimateDisplay: string
    lowerLimit: number | null
    upperLimit: number | null
  }>
}

export interface SanitizedRecommendation {
  id: string
  type: string
  productId: string
  productName: string
  calculationVersion: string
  evidenceMetrics: unknown
  proposedValue: unknown
  confidenceScore: number | null
  confidenceLabel: string
  sourceMetricIds: string[]
}

export interface SanitizedAiInput {
  context: {
    businessType: "retail_and_production"
    timezone: string
    currency: string
  }
  generatedAt: string
  metrics: SanitizedMetric[]
  forecasts: SanitizedForecast[]
  recommendations: SanitizedRecommendation[]
  limitations: string[]
}

export interface AiEvidenceText {
  text: string
  sourceMetricIds: string[]
}

export interface AiRisk extends AiEvidenceText {
  severity: "low" | "medium" | "high"
}

export interface AiRecommendation extends AiEvidenceText {
  requiresHumanReview: true
}

export interface AiStructuredOutput {
  summary: AiEvidenceText
  strengths: AiEvidenceText[]
  risks: AiRisk[]
  recommendations: AiRecommendation[]
}

export interface AiProviderResult {
  output: unknown
  providerRequestId: string | null
  inputTokens: number
  outputTokens: number
  latencyMs: number
  retryCount: number
}

export interface AiProvider {
  readonly name: AiProviderName
  readonly modelId: string
  generate(input: SanitizedAiInput): Promise<AiProviderResult>
}

export interface AiJob {
  id: string
  runType: "insights"
  status: "pending" | "processing" | "completed" | "failed"
  processedCount: number
  totalCount: number | null
  attempts: number
  errorCode: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface AiInsight {
  id: string
  runId: string
  runStatus: AiRunStatus
  provider: AiProviderName
  modelId: string
  promptVersion: string
  schemaVersion: string
  policyVersion: string
  type: "summary" | "strength" | "risk" | "recommendation"
  text: string
  severity: "low" | "medium" | "high" | null
  sourceMetricIds: string[]
  requiresHumanReview: boolean
  state: "pending" | "accepted" | "rejected"
  reviewer: { id: string; name: string } | null
  reviewedAt: string | null
  reviewReason: string | null
  createdAt: string
}

export interface AiInsightPage {
  data: AiInsight[]
  nextCursor: string | null
  availability: "available" | "unavailable"
  latestRunStatus: AiRunStatus | null
}
