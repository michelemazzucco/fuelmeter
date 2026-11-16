import { expect, it } from "vitest"
import { computePeriodStats, type DayLevels } from "./yearly-levels"

const levels = (entries: [number, number][]): DayLevels =>
  new Map(entries.map(([day, liters]) => [day, { liters, isReading: false }]))

/** `from`..`to` falling by `perDay` litres a day from `start` on day `from`. */
const falling = (from: number, to: number, start: number, perDay: number): [number, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, start - i * perDay])

it("counts the burn of every day of the range, the first included", () => {
  const byYear: [number, DayLevels][] = [[2025, levels(falling(1, 365, 1500, 2))]]
  const [year] = computePeriodStats(byYear, [2025], { fromDay: 100, toDay: 109 }).years

  expect(year.coveredDays).toBe(10)
  expect(year.complete).toBe(true)
  expect(year.consumed).toBe(20)
  expect(year.dailyLiters).toBe(2)
  expect(year.startLiters).toBe(1500 - 98 * 2)
  expect(year.endLiters).toBe(1500 - 108 * 2)
})

it("does not count a refill inside the range as negative use", () => {
  const days = levels([...falling(1, 50, 600, 4), ...falling(51, 100, 1500, 4)])
  const [year] = computePeriodStats([[2025, days]], [2025], { fromDay: 41, toDay: 60 }).years

  // 10 falling days before the refill, the refill day itself, 9 falling days after it
  expect(year.consumed).toBe(10 * 4 + 9 * 4)
  expect(year.endLiters).toBeGreaterThan(year.startLiters!)
})

it("marks a range that runs past the last known day as incomplete", () => {
  const byYear: [number, DayLevels][] = [[2026, levels(falling(1, 120, 1200, 3))]]
  const [year] = computePeriodStats(byYear, [2026], { fromDay: 101, toDay: 150 }).years

  expect(year.coveredDays).toBe(20)
  expect(year.rangeDays).toBe(50)
  expect(year.complete).toBe(false)
  expect(year.consumed).toBe(60)
})

it("returns nulls for a year with no level in the range", () => {
  const byYear: [number, DayLevels][] = [[2021, levels(falling(300, 365, 900, 1))]]
  const [year] = computePeriodStats(byYear, [2021], { fromDay: 91, toDay: 181 }).years

  expect(year).toMatchObject({ coveredDays: 0, complete: false, consumed: null, startLiters: null })
})

it("orders the years latest first and does not ask a non-leap year for day 366", () => {
  const byYear: [number, DayLevels][] = [
    [2024, levels(falling(1, 366, 1500, 1))],
    [2025, levels(falling(1, 365, 1500, 1))],
  ]
  const { years } = computePeriodStats(byYear, [2024, 2025], { fromDay: 360, toDay: 366 })

  expect(years.map((y) => y.year)).toEqual([2025, 2024])
  expect(years[0]).toMatchObject({ rangeDays: 6, complete: true })
  expect(years[1]).toMatchObject({ rangeDays: 7, complete: true })
})
