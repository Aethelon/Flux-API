import type {
  ConfidenceLabel,
  ForecastMethod,
  ForecastStatus,
  ForecastTargetType,
  RecommendationType,
} from "../../database/types.js"

export interface AnalyticsSettings {
  timezone: string
  currency: string
  forecastHorizon: number
  trainingBuckets: number
  minimumBuckets: number
  preferredBuckets: number
  seasonalCycle: number
  baselineTolerance: number
  baselinePolicy: "naive" | "reject"
  confidenceWeights: {
    coverage: number
    accuracy: number
    availability: number
  }
  confidenceThresholds: {
    high: number
    medium: number
  }
  stockoutExclusionRate: number
  serviceLevel: 0.9 | 0.95 | 0.975 | 0.99
  reviewPeriodDays: number
  demandWindowDays: number
  promotionOverstockThreshold: number
  promotionTurnoverThreshold: number
  promotionCap: number
  promotionCoefficient: number
  minimumGrossMargin: number
}

export interface AnalyticalBucket {
  bucketStart: string
  value: number
  eligible: boolean
  exclusionReason: string | null
  observedMinutes: number
  inStockMinutes: number
  stockoutMinutes: number
}

export interface ForecastPoint {
  id: string
  bucketStart: string
  horizon: number
  pointEstimate: number
  lowerLimit: number | null
  upperLimit: number | null
  seasonalFactor: number | null
  operationalValue: number
  calendarEvents: Array<{
    name: string
    kind: "season" | "retail" | "holiday" | "custom"
    source: string
    startsOn: string
    endsOn: string
  }>
}

export interface ForecastRun {
  id: string
  targetType: ForecastTargetType
  product: { id: string; name: string } | null
  method: ForecastMethod
  calculationVersion: string
  trainingFrom: string
  trainingTo: string
  bucketCount: number
  eligibleBucketCount: number
  dataQuality: unknown
  modelMetrics: unknown
  baselineMetrics: unknown
  confidenceScore: number | null
  confidenceLabel: ConfidenceLabel
  status: ForecastStatus
  limitations: unknown
  sourceSnapshotIds: string[]
  createdAt: string
  published: boolean
  points: ForecastPoint[]
}

export interface ForecastPage {
  data: ForecastRun[]
  nextCursor: string | null
}

export interface Recommendation {
  id: string
  runId: string
  calculationVersion: string
  configuration: unknown
  type: RecommendationType
  product: { id: string; name: string }
  evidenceMetrics: unknown
  proposedValue: unknown
  confidenceScore: number | null
  confidenceLabel: ConfidenceLabel
  state: "pending" | "accepted" | "rejected"
  reviewer: { id: string; name: string } | null
  reviewedAt: string | null
  reviewReason: string | null
  createdAt: string
}

export interface RecommendationPage {
  data: Recommendation[]
  nextCursor: string | null
}

export interface AnalyticsJob {
  id: string
  runType: "forecasts" | "recommendations"
  status: "pending" | "processing" | "completed" | "failed"
  processedCount: number
  totalCount: number | null
  attempts: number
  errorCode: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
