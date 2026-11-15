import type { ForecastPoint } from "./predictions"

/** Timestamps (ms), `from <= to`. */
export type TimeRange = { from: number; to: number }

export type ForecastPeriod = {
  range: TimeRange
  days: number
  startLiters: number
  endLiters: number
  consumed: number
  dailyLiters: number | null
  /** The period reaches past the last measured level, into the forecast. */
  estimated: boolean
}

const DAY_MS = 86_400_000

/** Level at `t`, linear between the two points around it. `points` is sorted by date. */
function levelAt(points: ForecastPoint[], t: number): number {
  if (t <= points[0].date) return points[0].level
  const last = points[points.length - 1]
  if (t >= last.date) return last.level
  const i = points.findIndex((p) => p.date >= t)
  const a = points[i - 1]
  const b = points[i]
  return a.level + ((b.level - a.level) * (t - a.date)) / (b.date - a.date)
}

/** Use and levels over one stretch of the run-out chart. Only drops count. */
export function computeForecastPeriod(
  points: ForecastPoint[],
  range: TimeRange
): ForecastPeriod | null {
  if (points.length === 0) return null

  const levels = [
    levelAt(points, range.from),
    ...points.filter((p) => p.date > range.from && p.date < range.to).map((p) => p.level),
    levelAt(points, range.to),
  ]
  let consumed = 0
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i + 1] < levels[i]) consumed += levels[i] - levels[i + 1]
  }

  const days = Math.round((range.to - range.from) / DAY_MS)
  // Forecast points are several days apart, so the forecast starts right
  // after the last measured point and not at the first forecast point.
  const lastMeasured = points.findLast((p) => !p.projected)

  return {
    range,
    days,
    startLiters: levels[0],
    endLiters: levels[levels.length - 1],
    consumed,
    dailyLiters: days > 0 ? consumed / days : null,
    estimated: lastMeasured === undefined || range.to > lastMeasured.date,
  }
}
