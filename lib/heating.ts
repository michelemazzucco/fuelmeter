import { addDays, differenceInDays, format, parseISO, startOfDay, startOfMonth, startOfWeek } from "date-fns"
import type { BoilerDay, BoilerHours, BoilerPeriod, Reading } from "./types"
import { computeTrendModel, dayKey, getAllConsumptionSegments } from "./predictions"

export type BoilerModel = {
  baseLitersPerDay: number // burn with the heating off (hot water, standby)
  litersPerHour: number    // extra burn per boiler-on hour
  intervals: number        // reading intervals fully covered by boiler data
  fitted: boolean          // false → base taken from the summer seasonal rate
}

export type BoilerContext = {
  model: BoilerModel
  hoursByDay: Map<string, number>
  correction: number // near-term multiplier on the seasonal rate, 1 = on season
}

const MIN_COVERAGE = 0.9
const MIN_COVERED_DAYS = 14
const MIN_FIT_INTERVALS = 3
// Below this the estimate of the non-heating litres outweighs the heating litres
const MIN_FIT_HOURS = 100
const CORRECTION_WINDOW_DAYS = 14
const MIN_CORRECTION_DAYS = 10

type Trend = { weights: number[] | null; calibratedRate: number | null }

type Observation = {
  drop: number  // litres burnt on the covered days
  days: number  // covered days
  hours: number // boiler hours on the covered days
  full: boolean // Netatmo covered at least 90 % of the interval
}

/**
 * Reading intervals inside one consumption cycle that Netatmo covered.
 *
 * At 90 % coverage and up, missing days are filled with the covered days' mean,
 * so a short API gap does not read as a cold-free day. Below that, the
 * observation keeps only the covered days, at least 14 of them, with the share
 * of the drop that the seasonal weights give those days.
 */
function observations(
  readings: Reading[],
  hoursByDay: Map<string, number>,
  weights: number[] | null
): Observation[] {
  const sorted = readings
    .filter((r) => r.level_liters != null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

  const result: Observation[] = []
  for (const segment of getAllConsumptionSegments(sorted)) {
    for (let i = 0; i < segment.length - 1; i++) {
      const start = startOfDay(new Date(segment[i].recorded_at))
      const days = differenceInDays(startOfDay(new Date(segment[i + 1].recorded_at)), start)
      const drop = segment[i].level_liters! - segment[i + 1].level_liters!
      if (days <= 0 || drop < 0) continue

      let hours = 0
      let covered = 0
      let coveredWeight = 0
      let totalWeight = 0
      for (let d = 0; d < days; d++) {
        const day = addDays(start, d)
        const weight = weights ? weights[day.getMonth()] : 1
        totalWeight += weight
        const h = hoursByDay.get(dayKey(day))
        if (h != null) {
          hours += h
          covered++
          coveredWeight += weight
        }
      }
      if (covered / days >= MIN_COVERAGE) {
        result.push({ drop, days, hours: (hours * days) / covered, full: true })
      } else if (covered >= MIN_COVERED_DAYS) {
        result.push({
          drop: (drop * coveredWeight) / totalWeight,
          days: covered,
          hours,
          full: false,
        })
      }
    }
  }
  return result
}

/** Least squares for drop = base·days + k·hours (no intercept). */
function fitTwoTerm(obs: Observation[]): { base: number; k: number } | null {
  let dd = 0, dh = 0, hh = 0, yd = 0, yh = 0
  for (const o of obs) {
    dd += o.days * o.days
    dh += o.days * o.hours
    hh += o.hours * o.hours
    yd += o.drop * o.days
    yh += o.drop * o.hours
  }
  const det = dd * hh - dh * dh
  // Near-collinear days and hours (every interval equally cold) cannot separate the two terms
  if (dd === 0 || hh === 0 || det / (dd * hh) < 0.05) return null
  return { base: (yd * hh - yh * dh) / det, k: (yh * dd - yd * dh) / det }
}

/**
 * Litres per boiler hour plus a daily base burn, fitted on reading intervals
 * that Netatmo covers in full. With fewer than 3 of those, or a fit that is
 * not physical, the base falls back to the lightest seasonal month (summer is
 * hot water only) and k takes up the rest of the measured drops, partly
 * covered intervals included.
 */
export function fitBoilerModel(
  readings: Reading[],
  hoursByDay: Map<string, number>,
  trend: Trend
): BoilerModel | null {
  const obs = observations(readings, hoursByDay, trend.weights)
  if (obs.length === 0) return null

  const full = obs.filter((o) => o.full)
  const fullHours = full.reduce((s, o) => s + o.hours, 0)
  if (full.length >= MIN_FIT_INTERVALS && fullHours >= MIN_FIT_HOURS) {
    const fit = fitTwoTerm(full)
    if (fit && fit.base >= 0 && fit.k > 0) {
      return { baseLitersPerDay: fit.base, litersPerHour: fit.k, intervals: full.length, fitted: true }
    }
  }

  if (trend.calibratedRate == null) return null
  const base = trend.calibratedRate * (trend.weights ? Math.min(...trend.weights) : 0)
  const totalHours = obs.reduce((s, o) => s + o.hours, 0)
  const rest = obs.reduce((s, o) => s + o.drop - base * o.days, 0)
  if (totalHours < MIN_FIT_HOURS || rest <= 0) return null
  return {
    baseLitersPerDay: base,
    litersPerHour: rest / totalHours,
    intervals: obs.length,
    fitted: false,
  }
}

export const dailyBurn = (model: BoilerModel, hours: number) =>
  model.baseLitersPerDay + model.litersPerHour * hours

/**
 * How far the last two weeks ran from the season: burn implied by real boiler
 * hours ÷ burn the seasonal model expects for the same days. Today is left out
 * because its total is still growing. Clamped to [0.5, 1.5].
 */
export function nearTermCorrection(
  model: BoilerModel,
  hoursByDay: Map<string, number>,
  trend: Trend,
  today: Date
): number {
  if (trend.calibratedRate == null) return 1
  let actual = 0
  let expected = 0
  let covered = 0
  for (let d = 1; d <= CORRECTION_WINDOW_DAYS; d++) {
    const day = addDays(today, -d)
    const hours = hoursByDay.get(dayKey(day))
    if (hours == null) continue
    actual += dailyBurn(model, hours)
    expected += trend.calibratedRate * (trend.weights ? trend.weights[day.getMonth()] : 1)
    covered++
  }
  if (covered < MIN_CORRECTION_DAYS || expected <= 0) return 1
  return Math.min(1.5, Math.max(0.5, actual / expected))
}

export function buildBoilerContext(
  readings: Reading[],
  boilerDays: BoilerDay[]
): BoilerContext | null {
  if (boilerDays.length === 0) return null
  const hoursByDay = new Map(boilerDays.map((d) => [d.day, d.hours]))
  const trend = computeTrendModel(readings)
  const model = fitBoilerModel(readings, hoursByDay, trend)
  if (!model) return null
  return {
    model,
    hoursByDay,
    correction: nearTermCorrection(model, hoursByDay, trend, startOfDay(new Date())),
  }
}

function sumByPeriod(days: BoilerDay[], periodStart: (date: Date) => Date): BoilerPeriod[] {
  const periods = new Map<string, BoilerPeriod>()
  for (const d of days) {
    const start = format(periodStart(parseISO(d.day)), "yyyy-MM-dd")
    const period = periods.get(start) ?? { start, hours: 0, days: 0 }
    period.hours += d.hours
    period.days++
    periods.set(start, period)
  }
  return [...periods.values()].sort((a, b) => a.start.localeCompare(b.start))
}

const weekStart = (date: Date) => startOfWeek(date, { weekStartsOn: 1 })

export function aggregateBoilerDays(days: BoilerDay[]) {
  return {
    weeks: sumByPeriod(days, weekStart),
    months: sumByPeriod(days, startOfMonth),
  }
}

/**
 * Totals for anonymous viewers. The week in progress is left out: its total
 * grows with every sync, so watching it would show day by day whether anyone
 * is heating the house. `today` is `yyyy-MM-dd` in the home timezone.
 */
export function publicBoilerHours(days: BoilerDay[], today: string) {
  const currentWeek = format(weekStart(parseISO(today)), "yyyy-MM-dd")
  return aggregateBoilerDays(days.filter((d) => d.day < currentWeek))
}

/**
 * Daily input for the model. Anonymous viewers only have weekly totals, so each
 * week is spread evenly over its first `days` days (the current week has data
 * only up to today).
 */
export function boilerDaysOf(hours: BoilerHours): BoilerDay[] {
  if (hours.resolution === "day") return hours.days
  return hours.weeks.flatMap((week) =>
    Array.from({ length: week.days }, (_, d) => ({
      day: format(addDays(parseISO(week.start), d), "yyyy-MM-dd"),
      hours: week.hours / week.days,
    }))
  )
}

export function boilerPeriodsOf(hours: BoilerHours): { weeks: BoilerPeriod[]; months: BoilerPeriod[] } {
  return hours.resolution === "day" ? aggregateBoilerDays(hours.days) : hours
}
