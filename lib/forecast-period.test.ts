import { expect, it } from "vitest"
import type { ForecastPoint } from "./predictions"
import { computeForecastPeriod } from "./forecast-period"

const DAY = 86_400_000
const T0 = new Date("2026-11-01T00:00:00").getTime()

// 10 measured days falling 2 L a day, then 20 forecast days falling 5 L a day
const points: ForecastPoint[] = Array.from({ length: 31 }, (_, i) => ({
  date: T0 + i * DAY,
  level: i <= 10 ? 1000 - i * 2 : 980 - (i - 10) * 5,
  projected: i > 10,
}))

it("sums the use of a stretch of the forecast", () => {
  const period = computeForecastPeriod(points, { from: T0 + 12 * DAY, to: T0 + 22 * DAY })!

  expect(period.days).toBe(10)
  expect(period.consumed).toBeCloseTo(50)
  expect(period.dailyLiters).toBeCloseTo(5)
  expect(period.startLiters).toBeCloseTo(970)
  expect(period.endLiters).toBeCloseTo(920)
  expect(period.estimated).toBe(true)
})

it("reads levels between two points and across the measured/forecast join", () => {
  const period = computeForecastPeriod(points, { from: T0 + 8.5 * DAY, to: T0 + 12 * DAY })!

  expect(period.startLiters).toBeCloseTo(983)
  expect(period.consumed).toBeCloseTo(1.5 * 2 + 2 * 5)
})

it("calls a stretch an estimate as soon as it passes the last measured point", () => {
  const sparse = points.filter((p) => !p.projected || (p.date - T0) / DAY >= 20)
  const period = computeForecastPeriod(sparse, { from: T0 + 9 * DAY, to: T0 + 11 * DAY })!

  expect(period.estimated).toBe(true)
})

it("does not call a fully measured stretch an estimate", () => {
  const period = computeForecastPeriod(points, { from: T0 + 2 * DAY, to: T0 + 6 * DAY })!

  expect(period.estimated).toBe(false)
  expect(period.consumed).toBeCloseTo(8)
})
