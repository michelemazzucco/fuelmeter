import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { addDays, differenceInDays } from "date-fns"
import type { Reading } from "./types"
import { BURNER_LITERS_PER_HOUR, fitBoilerModel, publicBoilerHours, type BoilerContext } from "./heating"
import { computeDailyHistory, computePrediction, computeTrendModel, dayKey } from "./predictions"

const BASE = 0.8
const K = 1.5
const TODAY = new Date(2026, 11, 10, 12)

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

function trueHours(date: Date): number {
  const dayOfYear = differenceInDays(date, new Date(date.getFullYear(), 0, 1, 12))
  const seasonal = Math.max(0, 1.2 + 4 * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365))
  return seasonal * (1 + 0.3 * Math.sin(dayOfYear * 1.7))
}

/** A tank that burns BASE + K·hours each day, read on `readingDays`, refilled when low. */
function simulate(start: Date, readingDays: Date[]): Reading[] {
  const readings: Reading[] = []
  let level = 1500
  let cursor = start
  const push = (is_refill: boolean) =>
    readings.push({
      id: String(readings.length),
      recorded_at: cursor.toISOString(),
      level_cm: null,
      level_liters: level,
      is_refill,
      notes: null,
      created_at: cursor.toISOString(),
    })
  push(true)
  for (const target of readingDays) {
    while (cursor < target) {
      level -= BASE + K * trueHours(cursor)
      cursor = addDays(cursor, 1)
    }
    push(false)
    if (level < 600) {
      cursor = addDays(cursor, 1)
      level = 1500
      push(true)
    }
  }
  return readings
}

function hoursBetween(ranges: [Date, Date][]): Map<string, number> {
  const hours = new Map<string, number>()
  for (const [from, to] of ranges) {
    for (let d = from; d < to; d = addDays(d, 1)) hours.set(dayKey(d), trueHours(d))
  }
  return hours
}

const history = [
  day(2023, 3, 1), day(2023, 6, 1), day(2023, 9, 1), day(2023, 12, 1),
  day(2024, 2, 15), day(2024, 5, 1), day(2024, 8, 1), day(2024, 11, 1),
  day(2025, 1, 15), day(2025, 4, 1), day(2025, 7, 1), day(2025, 9, 15),
  day(2026, 1, 15), day(2026, 3, 29),
]

const netatmoUntil = (end: Date): [Date, Date][] => [
  [day(2026, 5, 3), day(2026, 6, 23)],
  [day(2026, 9, 9), day(2026, 9, 26)],
  [day(2026, 10, 4), end],
]

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterAll(() => vi.useRealTimers())

describe("fitBoilerModel", () => {
  it("estimates litres per hour from one partly covered interval", () => {
    const end = day(2026, 12, 10)
    const readings = simulate(day(2022, 12, 1), [...history, end])
    const model = fitBoilerModel(readings, hoursBetween(netatmoUntil(end)), computeTrendModel(readings))

    expect(model).not.toBeNull()
    expect(model!.fitted).toBe(false)
    expect(model!.litersPerHour).toBeGreaterThan(K * 0.8)
    expect(model!.litersPerHour).toBeLessThan(K * 1.2)
  })

  it("stays inactive when no reading closes an interval with boiler data", () => {
    const readings = simulate(day(2022, 12, 1), history)
    expect(
      fitBoilerModel(readings, hoursBetween(netatmoUntil(TODAY)), computeTrendModel(readings))
    ).toBeNull()
  })

  it("stays inactive while the covered days hold under 100 boiler hours", () => {
    const end = day(2026, 11, 10)
    const readings = simulate(day(2022, 12, 1), [...history, end])
    expect(
      fitBoilerModel(readings, hoursBetween(netatmoUntil(end)), computeTrendModel(readings))
    ).toBeNull()
  })

  it("recovers base and litres per hour from fully covered intervals", () => {
    const readings = simulate(day(2022, 12, 1), history)
    const hours = hoursBetween([[day(2025, 1, 15), day(2026, 3, 29)]])
    const model = fitBoilerModel(readings, hours, computeTrendModel(readings))

    expect(model!.fitted).toBe(true)
    expect(model!.baseLitersPerDay).toBeCloseTo(BASE, 1)
    expect(model!.litersPerHour).toBeCloseTo(K, 1)
  })
})

describe("computeDailyHistory with a partly covered interval", () => {
  function setup() {
    const readings = simulate(day(2022, 12, 1), [...history, day(2026, 12, 10)])
    const hoursByDay = hoursBetween(netatmoUntil(day(2026, 12, 10)))
    const trend = computeTrendModel(readings)
    const boiler: BoilerContext = {
      model: fitBoilerModel(readings, hoursByDay, trend)!,
      hoursByDay,
      correction: 1,
    }
    const levels = computeDailyHistory(readings, trend, boiler)
    const levelOn = (date: Date) => levels.find((l) => dayKey(l.date) === dayKey(date))!.liters
    const burnOn = (date: Date) => levelOn(date) - levelOn(addDays(date, 1))
    return { readings, levelOn, burnOn }
  }

  it("still meets every reading", () => {
    const { readings, levelOn } = setup()
    for (const date of [day(2026, 3, 29), day(2026, 12, 10)]) {
      const reading = readings.find((r) => dayKey(new Date(r.recorded_at)) === dayKey(date))!
      expect(levelOn(date)).toBeCloseTo(reading.level_liters!, 6)
    }
  })

  it("burns more on a day with many boiler hours than on a day with few, in the same month", () => {
    const { burnOn } = setup()
    const november = Array.from({ length: 9 }, (_, d) => day(2026, 11, 1 + d))
    const byHours = [...november].sort((a, b) => trueHours(a) - trueHours(b))
    const coldest = byHours.at(-1)!
    const mildest = byHours[0]

    expect(trueHours(coldest)).toBeGreaterThan(trueHours(mildest) * 1.3)
    expect(burnOn(coldest) / burnOn(mildest)).toBeGreaterThan(1.2)
  })
})

describe("computePrediction without boiler data", () => {
  it("keeps the seasonal forecast", () => {
    const readings = simulate(day(2022, 12, 1), history)
    const prediction = computePrediction(readings, 1564)
    expect({
      runOut: dayKey(prediction.runOutDate!),
      dailyRate: prediction.dailyRateLiters,
      boilerAdjusted: prediction.boilerAdjusted,
    }).toMatchInlineSnapshot(`
      {
        "boilerAdjusted": false,
        "dailyRate": 8,
        "runOut": "2027-02-04",
      }
    `)
  })
})

describe("fitBoilerModel on summer intervals only", () => {
  it("does not fit litres per hour from a few boiler hours and dip-stick noise", () => {
    const hours = new Map<string, number>()
    const spread = (from: Date, days: number, total: number) => {
      for (let d = 0; d < days; d++) hours.set(dayKey(addDays(from, d)), total / days)
    }
    spread(day(2027, 5, 1), 30, 4)
    spread(day(2027, 5, 31), 30, 1)
    spread(day(2027, 6, 30), 30, 8)
    const at = (date: Date, liters: number, is_refill = false): Reading => ({
      id: date.toISOString(),
      recorded_at: date.toISOString(),
      level_cm: null,
      level_liters: liters,
      is_refill,
      notes: null,
      created_at: date.toISOString(),
    })
    const readings = [
      at(day(2027, 4, 20), 1500, true),
      at(day(2027, 5, 1), 1412),
      at(day(2027, 5, 31), 1358.5 - 12),
      at(day(2027, 6, 30), 1333 + 12),
      at(day(2027, 7, 30), 1297 - 12),
    ]

    const model = fitBoilerModel(readings, hours, { weights: null, calibratedRate: 1 })
    expect(model?.fitted ?? false).toBe(false)
  })
})

describe("fitBoilerModel with the burner flow limit", () => {
  it("caps a fitted litres per hour and moves the excess to the base", () => {
    const readings = simulate(day(2022, 12, 1), history)
    const halved = new Map(
      [...hoursBetween([[day(2025, 1, 15), day(2026, 3, 29)]])].map(([d, h]) => [d, h / 2])
    )
    const model = fitBoilerModel(readings, halved, computeTrendModel(readings))

    expect(model!.fitted).toBe(true)
    expect(model!.litersPerHour).toBe(BURNER_LITERS_PER_HOUR)
    expect(model!.baseLitersPerDay).toBeGreaterThan(BASE + 0.1)
    expect(model!.baseLitersPerDay).toBeLessThan(BASE + 1)
  })

  it("caps the fallback litres per hour and keeps the measured drop", () => {
    const start = day(2027, 1, 1)
    const hours = new Map<string, number>()
    for (let d = 0; d < 30; d++) hours.set(dayKey(addDays(start, d)), 4)
    const at = (date: Date, liters: number, is_refill = false): Reading => ({
      id: date.toISOString(),
      recorded_at: date.toISOString(),
      level_cm: null,
      level_liters: liters,
      is_refill,
      notes: null,
      created_at: date.toISOString(),
    })
    const readings = [at(start, 1500, true), at(addDays(start, 30), 1100)]

    const model = fitBoilerModel(readings, hours, { weights: null, calibratedRate: 1 })

    expect(model!.fitted).toBe(false)
    expect(model!.litersPerHour).toBe(BURNER_LITERS_PER_HOUR)
    expect(model!.baseLitersPerDay * 30 + model!.litersPerHour * 120).toBeCloseTo(400, 6)
  })
})

describe("publicBoilerHours", () => {
  const days = Array.from({ length: 21 }, (_, d) => ({
    day: dayKey(addDays(day(2026, 11, 1), d)),
    hours: 2,
  }))

  it("leaves out the week that is not finished", () => {
    const { weeks, months } = publicBoilerHours(days, "2026-11-18")
    expect(weeks.map((w) => w.start)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"])
    expect(weeks.at(-1)!.hours).toBe(14)
    expect(months).toEqual([{ start: "2026-11-01", hours: 30, days: 15 }])
  })
})
