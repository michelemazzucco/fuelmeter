import { afterAll, beforeAll, expect, it, vi } from "vitest"
import type { Reading } from "./types"
import { computeConsumptionStats, computePrediction } from "./predictions"

const reading = (date: string, liters: number, is_refill = false): Reading => ({
  id: date,
  recorded_at: `${date}T12:00:00.000Z`,
  level_cm: null,
  level_liters: liters,
  is_refill,
  notes: null,
  created_at: date,
})

const readings = [
  reading("2024-09-01", 1500, true),
  reading("2025-01-01", 1100),
  reading("2025-05-01", 700),
  reading("2025-08-30", 550),
  reading("2025-09-01", 1500, true),
  reading("2026-01-01", 1080),
  reading("2026-05-01", 690),
  reading("2026-09-01", 540),
  reading("2026-09-29", 1400, true),
]

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-10T12:00:00"))
})
afterAll(() => vi.useRealTimers())

it("counts the burn since the last refill up to today's estimated level", () => {
  const stats = computeConsumptionStats(readings)!
  const today = computePrediction(readings, 1564).forecastPoints.find((p: { projected: boolean; date: number }) => !p.projected && p.date === new Date("2026-11-10T00:00:00").getTime())!

  expect(stats.sinceRefill!.days).toBe(42)
  expect(stats.sinceRefill!.liters).toBeCloseTo(1400 - today.level, 0)
})

it("totals the 12-month window at its daily average", () => {
  const stats = computeConsumptionStats(readings)!
  expect(stats.totalLiters).toBeCloseTo(stats.dailyLiters * stats.coveredDays, 6)
  expect(stats.last30DailyLiters).toBeGreaterThan(0)
})
