import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  confidenceScore,
  fitOls,
  forecastOls,
  promotion,
} from "../src/modules/intelligence/math.js"
import { analyticalRegressionV1 } from "./fixtures/analytical-regression-v1.js"

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${String(actual)} != ${String(expected)}`,
  )
}

void describe(`analytical regression fixture ${analyticalRegressionV1.version}`, () => {
  void it("preserves the versioned trend forecast", () => {
    const fit = fitOls([...analyticalRegressionV1.trend.values])
    assert.ok(fit)

    close(fit.intercept, analyticalRegressionV1.trend.expected.intercept)
    close(fit.slope, analyticalRegressionV1.trend.expected.slope)
    close(
      fit.metrics.rSquared ?? 0,
      analyticalRegressionV1.trend.expected.rSquared,
    )
    assert.deepEqual(
      forecastOls(
        fit,
        analyticalRegressionV1.trend.values.length,
        analyticalRegressionV1.trend.values.length,
      ),
      analyticalRegressionV1.trend.expected.forecast,
    )
  })

  void it("preserves the versioned confidence score", () => {
    const result = confidenceScore(analyticalRegressionV1.confidence.input)

    close(result.score, analyticalRegressionV1.confidence.expected.score)
    assert.equal(result.label, analyticalRegressionV1.confidence.expected.label)
  })

  void it("preserves the versioned promotion boundaries", () => {
    const result = promotion(analyticalRegressionV1.promotion.input)

    close(
      result.baseDiscountRate,
      analyticalRegressionV1.promotion.expected.baseDiscountRate,
    )
    close(
      result.maximumMarginSafeDiscountRate ?? 0,
      analyticalRegressionV1.promotion.expected.maximumMarginSafeDiscountRate,
    )
    close(
      result.suggestedDiscountRate ?? 0,
      analyticalRegressionV1.promotion.expected.suggestedDiscountRate,
    )
    assert.equal(
      result.suggestedPriceCents,
      analyticalRegressionV1.promotion.expected.suggestedPriceCents,
    )
  })
})
