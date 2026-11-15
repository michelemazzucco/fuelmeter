import { addDays, differenceInDays, endOfYear, format, getDayOfYear, getDaysInYear } from "date-fns"
import { computeDailyHistory, computeTrendModel, projectLevels } from "./predictions"
import type { Reading } from "./types"
import type { BoilerContext } from "./heating"

export type DayLevels = Map<number, { liters: number; isReading: boolean }>

export type YearlyLevels = {
  byYear: [number, DayLevels][]
  projection: { year: number; days: Map<number, number> } | null
}

/**
 * `computeDailyHistory` sliced per calendar year for the day-of-year axis,
 * plus a forecast series running from the last known day to the run-out date,
 * clipped at 31 December — past that the day-of-year would wrap and draw back
 * over the same line.
 *
 * The forecast is kept out of `byYear` so it never reaches the year stats.
 */
export function computeDailyLevels(readings: Reading[], boiler?: BoilerContext): YearlyLevels {
  const trend = computeTrendModel(readings)
  const history = computeDailyHistory(readings, trend, boiler)

  const byYear = new Map<number, DayLevels>()
  for (const point of history) {
    const year = point.date.getFullYear()
    const days = byYear.get(year) ?? new Map()
    days.set(getDayOfYear(point.date), { liters: point.liters, isReading: point.isReading })
    byYear.set(year, days)
  }

  let projection: YearlyLevels["projection"] = null
  const last = history[history.length - 1]
  if (last && trend.calibratedRate != null) {
    const tailDays = differenceInDays(endOfYear(last.date), last.date)
    const levels = projectLevels(last.liters, last.date, tailDays, {
      weights: trend.weights,
      calibratedRate: trend.calibratedRate,
    })
    const days = new Map<number, number>()
    for (let d = 0; d <= tailDays; d++) {
      days.set(getDayOfYear(addDays(last.date, d)), levels[d])
      if (levels[d] <= 0) break
    }
    projection = { year: last.date.getFullYear(), days }
  }

  return {
    byYear: [...byYear.entries()].sort(([a], [b]) => a - b),
    projection,
  }
}

/** Litres consumed from the first covered day up to `throughDay` (drops only — refill rises don't count). */
export function consumedThrough(days: DayLevels, throughDay: number): number {
  const sorted = [...days.keys()].filter((d) => d <= throughDay).sort((a, b) => a - b)
  let sum = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = days.get(sorted[i])!.liters
    const b = days.get(sorted[i + 1])!.liters
    if (b < a) sum += a - b
  }
  return sum
}

export type YearStats = {
  currentYear: number
  consumedYtd: number
  prevYear: number | null
  prevYearTotal: number | null
  vsPrevPct: number | null
  levelDiff: number | null
}

/** Current year vs previous year, compared over the same portion of the year. */
export function computeYearStats(byYear: [number, DayLevels][]): YearStats | null {
  if (byYear.length === 0) return null
  const [currentYear, curDays] = byYear[byYear.length - 1]
  const curLast = Math.max(...curDays.keys())

  const stats: YearStats = {
    currentYear,
    consumedYtd: consumedThrough(curDays, curLast),
    prevYear: null,
    prevYearTotal: null,
    vsPrevPct: null,
    levelDiff: null,
  }

  const prevEntry = byYear.find(([y]) => y === currentYear - 1)
  if (!prevEntry) return stats
  const [prevYear, prevDays] = prevEntry
  stats.prevYear = prevYear
  stats.prevYearTotal = consumedThrough(prevDays, Math.max(...prevDays.keys()))

  // Consumption compared over the days both years cover
  const through = Math.min(curLast, Math.max(...prevDays.keys()))
  const curSame = consumedThrough(curDays, through)
  const prevSame = consumedThrough(prevDays, through)
  if (prevSame > 0) {
    stats.vsPrevPct = ((curSame - prevSame) / prevSame) * 100
  }

  // Tank level today vs the same day last year
  const prevSameDay = [...prevDays.keys()]
    .filter((d) => d <= curLast)
    .sort((a, b) => b - a)[0]
  if (prevSameDay !== undefined) {
    stats.levelDiff = curDays.get(curLast)!.liters - prevDays.get(prevSameDay)!.liters
  }

  return stats
}

/** Day-of-year range, inclusive on both ends, `fromDay <= toDay`. */
export type DayRange = { fromDay: number; toDay: number }

export type PeriodYear = {
  year: number
  /** Days of the range the year has a level for. */
  coveredDays: number
  /** Days of the range that exist in the year (a non-leap year has no day 366). */
  rangeDays: number
  complete: boolean
  startLiters: number | null
  endLiters: number | null
  consumed: number | null
  dailyLiters: number | null
}

export type PeriodStats = { range: DayRange; years: PeriodYear[] }

/**
 * The same portion of the year in each of `years`, latest year first.
 *
 * A day's level is the level at the end of that day, so the burn of `fromDay`
 * is the drop from the day before it: the period starts from that level when
 * the year has it. Only drops count, as in `consumedThrough`.
 */
export function computePeriodStats(
  byYear: [number, DayLevels][],
  years: number[],
  range: DayRange
): PeriodStats {
  const levels = new Map(byYear)
  const stats = [...years]
    .sort((a, b) => b - a)
    .map((year): PeriodYear => {
      const days = levels.get(year)
      const lastDay = Math.min(range.toDay, getDaysInYear(new Date(year, 0, 1)))
      const rangeDays = Math.max(0, lastDay - range.fromDay + 1)

      const points: number[] = []
      let coveredDays = 0
      for (let d = range.fromDay - 1; d <= lastDay; d++) {
        const level = days?.get(d)
        if (!level) continue
        points.push(level.liters)
        if (d >= range.fromDay) coveredDays++
      }

      if (coveredDays === 0) {
        return {
          year,
          coveredDays,
          rangeDays,
          complete: false,
          startLiters: null,
          endLiters: null,
          consumed: null,
          dailyLiters: null,
        }
      }

      let consumed = 0
      for (let i = 0; i < points.length - 1; i++) {
        if (points[i + 1] < points[i]) consumed += points[i] - points[i + 1]
      }
      const intervals = points.length - 1

      return {
        year,
        coveredDays,
        rangeDays,
        complete: coveredDays === rangeDays,
        startLiters: points[0],
        endLiters: points[points.length - 1],
        consumed,
        dailyLiters: intervals > 0 ? consumed / intervals : null,
      }
    })

  return { range, years: stats }
}

// The axis runs to 366 on a non-leap reference year: day 366 reads as 31 DEC, not 1 JAN.
export const dayOfYearLabel = (day: number) =>
  format(addDays(new Date(2001, 0, 1), Math.min(day, 365) - 1), "d MMM").toUpperCase()

export const dayRangeLabel = ({ fromDay, toDay }: DayRange) =>
  fromDay === toDay
    ? dayOfYearLabel(fromDay)
    : `${dayOfYearLabel(fromDay)} – ${dayOfYearLabel(toDay)}`
