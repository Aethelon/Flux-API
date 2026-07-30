import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  compactAiValue,
  metricResultForAi,
} from "../src/modules/ai/ai-input.js"

void describe("AI input compaction", () => {
  void it("summarizes long numeric series", () => {
    const result = compactAiValue(Array.from({ length: 30 }, (_, index) => index + 1))
    assert.deepEqual(result, {
      observationCount: 30,
      minimum: 1,
      maximum: 30,
      total: 465,
      average: 15.5,
      first: 1,
      last: 30,
    })
  })

  void it("preserves short series", () => {
    assert.deepEqual(compactAiValue([1, 2, 3]), [1, 2, 3])
  })

  void it("removes redundant per-horizon diagnostics", () => {
    assert.deepEqual(compactAiValue({
      mae: 10,
      backtestByHorizon: [{ horizon: 1, mae: 12 }],
      byHorizon: [{ horizon: 1, mae: 9 }],
    }), { mae: 10 })
  })

  void it("labels monthly revenue values with months and cent units", () => {
    assert.deepEqual(metricResultForAi(
      "monthly_net_revenue",
      new Date("2026-05-01T00:00:00.000Z"),
      { eligibleValues: [100_000, 125_050, 98_900] },
    ), {
      months: ["2026-05", "2026-06", "2026-07"],
      netRevenueCents: [100_000, 125_050, 98_900],
      netRevenueBrl: ["R$ 1.000,00", "R$ 1.250,50", "R$ 989,00"],
    })
  })
})
