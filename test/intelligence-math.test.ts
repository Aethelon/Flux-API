import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  confidenceScore,
  errorMetrics,
  fitOls,
  forecastOls,
  promotion,
  replenishment,
  rollingOriginBacktest,
  seasonalFactors,
  studentTCritical95,
} from "../src/modules/intelligence/math.js"

function close(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${String(actual)} != ${String(expected)}`,
  )
}

void describe("deterministic intelligence mathematics", () => {
  void it("fits an exact OLS trend and prediction interval", () => {
    const fit = fitOls([2, 4, 6, 8])
    assert.ok(fit)
    close(fit.intercept, 2)
    close(fit.slope, 2)
    close(fit.metrics.rSquared ?? 0, 1)
    assert.deepEqual(forecastOls(fit, 4, 4), {
      point: 10,
      lower: 10,
      upper: 10,
    })
  })

  void it("returns documented residual metrics and zero-denominator states", () => {
    const metrics = errorMetrics([0, 0, 0], [1, 0, 2])
    close(metrics.sse, 5)
    close(metrics.mse, 5 / 3)
    close(metrics.mae, 1)
    assert.equal(metrics.wape, null)
    assert.equal(metrics.bias, null)
    close(studentTCritical95(2), 4.303)
  })

  void it("normalizes seasonal factors to a mean of one", () => {
    const values = Array.from({ length: 24 }, (_, index) =>
      (10 + index) * (index % 12 === 0 ? 1.2 : 1)
    )
    const fit = fitOls(values)
    assert.ok(fit)
    const result = seasonalFactors(
      values,
      fit,
      values.map((_, index) => index % 12),
      12,
    )
    assert.equal(result.enabled, true)
    close(result.factors.reduce((total, value) => total + value, 0) / 12, 1)
  })

  void it("performs rolling-origin comparison against the naive baseline", () => {
    const result = rollingOriginBacktest([1, 2, 3, 4, 5, 6], 3, 2)
    assert.ok(result)
    assert.equal(result.points.length, 5)
    assert.deepEqual(result.byHorizon.map((item) => item.horizon), [1, 2])
    assert.ok((result.model.wape ?? 1) < (result.baseline.wape ?? 0))
  })

  void it("calculates transparent confidence labels", () => {
    const result = confidenceScore({
      eligibleBucketCount: 12,
      preferredBucketCount: 12,
      backtestWape: 0.1,
      availabilityScore: 1,
      baselineBeaten: true,
    })
    close(result.score, 95.5)
    assert.equal(result.label, "high")
  })

  void it("calculates replenishment and every rounding boundary", () => {
    const result = replenishment({
      dailyDemand: [2, 4, 3, 5],
      onHand: 5,
      reserved: 1,
      onOrder: 2,
      configuredLeadTimeDays: 3,
      observedLeadTimeDays: [],
      reviewPeriodDays: 7,
      serviceLevel: 0.95,
      quantityScale: 0,
      packMultiple: 4,
      minimumOrderQuantity: 10,
    })
    close(result.meanDailyDemand, 3.5)
    assert.equal(result.inventoryPosition, 6)
    assert.equal(result.leadTimeSource, "configured")
    assert.ok(result.safetyStock > 0)
    assert.equal(result.packRoundedSuggestion % 4, 0)
    assert.ok(result.finalSuggestion >= 10)
    assert.equal(result.finalSuggestion % 4, 0)
    assert.ok(result.stockoutProbability >= 0 && result.stockoutProbability <= 1)
  })

  void it("caps promotion discount by the required margin", () => {
    const result = promotion({
      inventoryPosition: 100,
      orderUpToTarget: 20,
      sellingPriceCents: 1_000,
      unitCostCents: 700,
      minimumGrossMargin: 0.2,
      promotionCap: 0.3,
      coefficient: 0.5,
    })
    close(result.baseDiscountRate, 0.3)
    close(result.maximumMarginSafeDiscountRate ?? 0, 0.125)
    close(result.suggestedDiscountRate ?? 0, 0.125)
    assert.equal(result.suggestedPriceCents, 875)
  })
})
