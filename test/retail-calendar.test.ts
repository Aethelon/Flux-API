import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  brazilRetailCalendar,
  brazilRetailEventsBetween,
  monthEnd,
} from "../src/modules/intelligence/retail-calendar.js"

void describe("Brazil retail calendar", () => {
  void it("exposes movable and fixed retail periods for the forecast horizon", () => {
    const calendar = brazilRetailCalendar(2026)
    assert.deepEqual(
      calendar.find((event) => event.name === "Dia dos Pais"),
      {
        name: "Dia dos Pais",
        startsOn: "2026-07-26",
        endsOn: "2026-08-09",
        kind: "retail",
        source: "brazil-retail-calendar",
      },
    )
    assert.equal(
      calendar.find((event) => event.name === "Black Friday")?.endsOn,
      "2026-11-27",
    )
  })

  void it("lists the events overlapping one forecast month", () => {
    const august = brazilRetailEventsBetween("2026-08-01", monthEnd("2026-08-01"))
    assert.ok(august.some((event) => event.name === "Inverno"))
    assert.ok(august.some((event) => event.name === "Dia dos Pais"))
  })
})
