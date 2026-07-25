export const ANALYTICS_CALCULATION_VERSION = "analytics-v1"
const EPSILON = 1e-9

export interface RegressionFit {
  intercept: number
  slope: number
  xMean: number
  yMean: number
  sxx: number
  residualStandardError: number
  metrics: ErrorMetrics & { rSquared: number | null }
}

export interface ErrorMetrics {
  sse: number
  mse: number
  rmse: number
  mae: number
  wape: number | null
  bias: number | null
}

export interface ForecastValue {
  point: number
  lower: number
  upper: number
}

export interface BacktestPoint {
  origin: number
  horizon: number
  actual: number
  predicted: number
  naivePredicted: number
  residual: number
}

export interface BacktestResult {
  points: BacktestPoint[]
  model: ErrorMetrics
  baseline: ErrorMetrics
  byHorizon: Array<{
    horizon: number
    model: ErrorMetrics
    baseline: ErrorMetrics
  }>
}

export interface ReplenishmentInput {
  dailyDemand: number[]
  onHand: number
  reserved: number
  onOrder: number
  configuredLeadTimeDays: number
  observedLeadTimeDays: number[]
  reviewPeriodDays: number
  serviceLevel: 0.9 | 0.95 | 0.975 | 0.99
  quantityScale: number
  packMultiple: number
  minimumOrderQuantity: number
}

export interface ReplenishmentResult {
  meanDailyDemand: number
  demandStandardDeviation: number
  inventoryPosition: number
  leadTimeDays: number
  leadTimeStandardDeviation: number | null
  leadTimeSource: "observed" | "configured"
  meanLeadDemand: number
  safetyStock: number
  reorderPoint: number
  orderUpToTarget: number
  rawSuggestion: number
  scaleRoundedSuggestion: number
  packRoundedSuggestion: number
  finalSuggestion: number
  daysOfCover: number | null
  stockoutProbability: number
}

export interface PromotionInput {
  inventoryPosition: number
  orderUpToTarget: number
  sellingPriceCents: number
  unitCostCents: number | null
  minimumGrossMargin: number
  promotionCap: number
  coefficient: number
}

export interface PromotionResult {
  excessUnits: number
  overstockRatio: number
  baseDiscountRate: number
  maximumMarginSafeDiscountRate: number | null
  suggestedDiscountRate: number | null
  suggestedPriceCents: number | null
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

export function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(
    sum(values.map((value) => (value - average) ** 2)) / (values.length - 1),
  )
}

export function errorMetrics(
  actual: number[],
  predicted: number[],
): ErrorMetrics {
  if (actual.length !== predicted.length || actual.length === 0) {
    throw new Error("Actual and predicted values must have the same non-zero length.")
  }
  const residuals = actual.map((value, index) => value - (predicted[index] ?? 0))
  const absoluteErrors = residuals.map(Math.abs)
  const sse = sum(residuals.map((value) => value ** 2))
  const denominator = sum(actual.map(Math.abs))
  return {
    sse,
    mse: sse / actual.length,
    rmse: Math.sqrt(sse / actual.length),
    mae: sum(absoluteErrors) / actual.length,
    wape: denominator === 0 ? null : sum(absoluteErrors) / denominator,
    bias: denominator === 0 ? null : sum(residuals) / denominator,
  }
}

export function fitOls(values: number[]): RegressionFit | null {
  if (values.length < 3) return null
  const x = values.map((_, index) => index)
  const xMean = mean(x)
  const yMean = mean(values)
  const sxx = sum(x.map((value) => (value - xMean) ** 2))
  if (sxx === 0) return null
  const sxy = sum(x.map((value, index) =>
    (value - xMean) * ((values[index] ?? 0) - yMean)
  ))
  const slope = sxy / sxx
  const intercept = yMean - (slope * xMean)
  const predicted = x.map((value) => intercept + (slope * value))
  const metrics = errorMetrics(values, predicted)
  const sst = sum(values.map((value) => (value - yMean) ** 2))
  const rSquared = sst === 0
    ? metrics.sse === 0 ? 1 : null
    : 1 - (metrics.sse / sst)
  return {
    intercept,
    slope,
    xMean,
    yMean,
    sxx,
    residualStandardError: Math.sqrt(metrics.sse / (values.length - 2)),
    metrics: { ...metrics, rSquared },
  }
}

const T_975 = [
  0,
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.160,
  2.145,
  2.131,
  2.120,
  2.110,
  2.101,
  2.093,
  2.086,
  2.080,
  2.074,
  2.069,
  2.064,
  2.060,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
] as const

export function studentTCritical95(degreesOfFreedom: number): number {
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new Error("Degrees of freedom must be a positive integer.")
  }
  if (degreesOfFreedom <= 30) return T_975[degreesOfFreedom] ?? 1.96
  if (degreesOfFreedom <= 40) return 2.021
  if (degreesOfFreedom <= 60) return 2.000
  if (degreesOfFreedom <= 120) return 1.980
  return 1.960
}

export function forecastOls(
  fit: RegressionFit,
  trainingSize: number,
  futureIndex: number,
  seasonalFactor = 1,
): ForecastValue {
  const trend = Math.max(0, fit.intercept + (fit.slope * futureIndex))
  const standardError = fit.residualStandardError * Math.sqrt(
    1
      + (1 / trainingSize)
      + (((futureIndex - fit.xMean) ** 2) / fit.sxx),
  )
  const margin = studentTCritical95(trainingSize - 2) * standardError
  return {
    point: trend * seasonalFactor,
    lower: Math.max(0, trend - margin) * seasonalFactor,
    upper: Math.max(0, trend + margin) * seasonalFactor,
  }
}

export function seasonalFactors(
  values: number[],
  fit: RegressionFit,
  seasonalPositions: number[],
  cycleLength: number,
): { factors: number[]; enabled: boolean; reason: string | null } {
  if (values.length < cycleLength * 2 || seasonalPositions.length !== values.length) {
    return {
      factors: Array.from({ length: cycleLength }, () => 1),
      enabled: false,
      reason: "insufficient_seasonal_cycles",
    }
  }
  const grouped = Array.from({ length: cycleLength }, () => [] as number[])
  for (const [index, value] of values.entries()) {
    const trend = fit.intercept + (fit.slope * index)
    const position = seasonalPositions[index]
    if (position === undefined || position < 0 || position >= cycleLength || trend <= EPSILON) {
      return {
        factors: Array.from({ length: cycleLength }, () => 1),
        enabled: false,
        reason: "unstable_seasonal_trend",
      }
    }
    grouped[position]?.push(value / Math.max(EPSILON, trend))
  }
  if (grouped.some((group) => group.length < 2)) {
    return {
      factors: Array.from({ length: cycleLength }, () => 1),
      enabled: false,
      reason: "missing_seasonal_position",
    }
  }
  const raw = grouped.map(mean)
  const normalization = mean(raw)
  if (normalization <= EPSILON) {
    return {
      factors: Array.from({ length: cycleLength }, () => 1),
      enabled: false,
      reason: "unstable_seasonal_normalization",
    }
  }
  return {
    factors: raw.map((value) => value / normalization),
    enabled: true,
    reason: null,
  }
}

export function rollingOriginBacktest(
  values: number[],
  minimumTrainingSize = 3,
  maximumHorizon = 1,
): BacktestResult | null {
  if (values.length <= minimumTrainingSize) return null
  const points: BacktestPoint[] = []
  for (let origin = minimumTrainingSize; origin < values.length; origin += 1) {
    const training = values.slice(0, origin)
    const fit = fitOls(training)
    if (!fit) continue
    for (
      let horizon = 1;
      horizon <= maximumHorizon && origin + horizon - 1 < values.length;
      horizon += 1
    ) {
      const actual = values[origin + horizon - 1] ?? 0
      const predicted = forecastOls(
        fit,
        training.length,
        training.length + horizon - 1,
      ).point
      const naivePredicted = training.at(-1) ?? 0
      points.push({
        origin,
        horizon,
        actual,
        predicted,
        naivePredicted,
        residual: actual - predicted,
      })
    }
  }
  if (points.length === 0) return null
  const byHorizon = [...new Set(points.map((point) => point.horizon))]
    .map((horizon) => {
      const selected = points.filter((point) => point.horizon === horizon)
      return {
        horizon,
        model: errorMetrics(
          selected.map((point) => point.actual),
          selected.map((point) => point.predicted),
        ),
        baseline: errorMetrics(
          selected.map((point) => point.actual),
          selected.map((point) => point.naivePredicted),
        ),
      }
    })
  return {
    points,
    model: errorMetrics(
      points.map((point) => point.actual),
      points.map((point) => point.predicted),
    ),
    baseline: errorMetrics(
      points.map((point) => point.actual),
      points.map((point) => point.naivePredicted),
    ),
    byHorizon,
  }
}

export function confidenceScore(input: {
  eligibleBucketCount: number
  preferredBucketCount: number
  backtestWape: number | null
  availabilityScore: number
  baselineBeaten: boolean
  weights?: {
    coverage: number
    accuracy: number
    availability: number
  }
  thresholds?: {
    high: number
    medium: number
  }
}): { score: number; label: "high" | "medium" | "low" } {
  const weights = input.weights ?? {
    coverage: 0.35,
    accuracy: 0.45,
    availability: 0.20,
  }
  const thresholds = input.thresholds ?? { high: 75, medium: 50 }
  const coverage = Math.min(1, input.eligibleBucketCount / input.preferredBucketCount)
  const accuracy = input.backtestWape === null
    ? 0
    : Math.max(0, 1 - Math.min(1, input.backtestWape))
  const availability = Math.max(0, Math.min(1, input.availabilityScore))
  const score = 100 * (
    (weights.coverage * coverage)
    + (weights.accuracy * accuracy)
    + (weights.availability * availability)
  )
  return {
    score,
    label: score >= thresholds.high && input.baselineBeaten
      ? "high"
      : score >= thresholds.medium && input.baselineBeaten
        ? "medium"
        : "low",
  }
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + (0.3275911 * x))
  const polynomial = (((((1.061405429 * t) - 1.453152027) * t + 1.421413741)
    * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - (polynomial * Math.exp(-(x ** 2))))
}

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)))
}

function serviceLevelZ(level: ReplenishmentInput["serviceLevel"]): number {
  switch (level) {
    case 0.9: return 1.282
    case 0.95: return 1.645
    case 0.975: return 1.960
    case 0.99: return 2.326
  }
}

function ceilToScale(value: number, scale: number): number {
  const factor = 10 ** scale
  return Math.ceil((value * factor) - EPSILON) / factor
}

function ceilToMultiple(value: number, multiple: number): number {
  if (value <= 0) return 0
  return Math.ceil((value / multiple) - EPSILON) * multiple
}

export function replenishment(input: ReplenishmentInput): ReplenishmentResult {
  const meanDailyDemand = mean(input.dailyDemand)
  const demandStandardDeviation = sampleStandardDeviation(input.dailyDemand)
  const inventoryPosition = input.onHand + input.onOrder - input.reserved
  const observedLeadTimes = input.observedLeadTimeDays.filter((value) => value >= 0)
  const observed = observedLeadTimes.length >= 2
  const leadTimeDays = observed ? mean(observedLeadTimes) : input.configuredLeadTimeDays
  const leadTimeStandardDeviation = observed
    ? sampleStandardDeviation(observedLeadTimes)
    : null
  const z = serviceLevelZ(input.serviceLevel)
  const meanLeadDemand = meanDailyDemand * leadTimeDays
  const leadVariance = observed && leadTimeStandardDeviation !== null
    ? (leadTimeDays * (demandStandardDeviation ** 2))
      + ((meanDailyDemand ** 2) * (leadTimeStandardDeviation ** 2))
    : leadTimeDays * (demandStandardDeviation ** 2)
  const leadStandardDeviation = Math.sqrt(Math.max(0, leadVariance))
  const safetyStock = z * leadStandardDeviation
  const reorderPoint = meanLeadDemand + safetyStock
  const orderUpToTarget = (meanDailyDemand * (leadTimeDays + input.reviewPeriodDays))
    + safetyStock
  const rawSuggestion = Math.max(0, orderUpToTarget - inventoryPosition)
  const scaleRoundedSuggestion = ceilToScale(rawSuggestion, input.quantityScale)
  const packRoundedSuggestion = ceilToMultiple(
    scaleRoundedSuggestion,
    input.packMultiple,
  )
  const finalSuggestion = packRoundedSuggestion === 0
    ? 0
    : ceilToMultiple(
        Math.max(packRoundedSuggestion, input.minimumOrderQuantity),
        input.packMultiple,
      )
  const daysOfCover = meanDailyDemand <= 0 ? null : inventoryPosition / meanDailyDemand
  const stockoutProbability = leadStandardDeviation === 0
    ? inventoryPosition >= meanLeadDemand ? 0 : 1
    : 1 - normalCdf((inventoryPosition - meanLeadDemand) / leadStandardDeviation)

  return {
    meanDailyDemand,
    demandStandardDeviation,
    inventoryPosition,
    leadTimeDays,
    leadTimeStandardDeviation,
    leadTimeSource: observed ? "observed" : "configured",
    meanLeadDemand,
    safetyStock,
    reorderPoint,
    orderUpToTarget,
    rawSuggestion,
    scaleRoundedSuggestion,
    packRoundedSuggestion,
    finalSuggestion,
    daysOfCover,
    stockoutProbability: Math.max(0, Math.min(1, stockoutProbability)),
  }
}

export function promotion(input: PromotionInput): PromotionResult {
  const excessUnits = Math.max(0, input.inventoryPosition - input.orderUpToTarget)
  const overstockRatio = excessUnits / Math.max(input.inventoryPosition, 1)
  const baseDiscountRate = Math.min(input.promotionCap, input.coefficient * overstockRatio)
  if (input.unitCostCents === null || input.sellingPriceCents <= 0) {
    return {
      excessUnits,
      overstockRatio,
      baseDiscountRate,
      maximumMarginSafeDiscountRate: null,
      suggestedDiscountRate: null,
      suggestedPriceCents: null,
    }
  }
  const maximumMarginSafeDiscountRate = Math.max(
    0,
    Math.min(
      input.promotionCap,
      1 - (
        input.unitCostCents
        / (input.sellingPriceCents * (1 - input.minimumGrossMargin))
      ),
    ),
  )
  const suggestedDiscountRate = Math.min(
    baseDiscountRate,
    maximumMarginSafeDiscountRate,
  )
  return {
    excessUnits,
    overstockRatio,
    baseDiscountRate,
    maximumMarginSafeDiscountRate,
    suggestedDiscountRate,
    suggestedPriceCents: Math.round(
      input.sellingPriceCents * (1 - suggestedDiscountRate),
    ),
  }
}
