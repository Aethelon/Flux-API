export const analyticalRegressionV1 = {
  version: "v1",
  trend: {
    values: [2, 4, 6, 8],
    expected: {
      intercept: 2,
      slope: 2,
      rSquared: 1,
      forecast: {
        point: 10,
        lower: 10,
        upper: 10,
      },
    },
  },
  confidence: {
    input: {
      eligibleBucketCount: 12,
      preferredBucketCount: 12,
      backtestWape: 0.1,
      availabilityScore: 1,
      baselineBeaten: true,
    },
    expected: {
      score: 95.5,
      label: "high",
    },
  },
  promotion: {
    input: {
      inventoryPosition: 100,
      orderUpToTarget: 20,
      sellingPriceCents: 1_000,
      unitCostCents: 700,
      minimumGrossMargin: 0.2,
      promotionCap: 0.3,
      coefficient: 0.5,
    },
    expected: {
      baseDiscountRate: 0.3,
      maximumMarginSafeDiscountRate: 0.125,
      suggestedDiscountRate: 0.125,
      suggestedPriceCents: 875,
    },
  },
} as const
