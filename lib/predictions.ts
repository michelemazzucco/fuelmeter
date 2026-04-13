import { differenceInDays, addDays, format } from "date-fns"
import type { Reading } from "./supabase"

export type ForecastPoint = {
  date: string
  level: number
  projected: boolean
}

/**
 * Finds the most recent continuous downward segment of readings.
 * This handles tank refills — we only use consumption since the last fill-up.
 * Only readings with known level_liters are considered.
 */
function getLastConsumptionSegment(readings: Reading[]): Reading[] {
  if (readings.length < 2) return readings

  let segmentStart = 0
  for (let i = readings.length - 1; i > 0; i--) {
    const curr = readings[i].level_liters!
    const prev = readings[i - 1].level_liters!
    if (curr > prev) {
      segmentStart = i
      break
    }
  }

  return readings.slice(segmentStart)
}

export function computePrediction(
  readings: Reading[],
  capacityLiters: number
): {
  dailyRateLiters: number | null
  runOutDate: Date | null
  daysRemaining: number | null
  forecastPoints: ForecastPoint[]
  hasEnoughData: boolean
} {
  // Only readings with known liters are usable for prediction
  const withLiters = readings.filter((r) => r.level_liters != null)

  const sorted = [...withLiters].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  )

  const segment = getLastConsumptionSegment(sorted)

  if (segment.length < 2) {
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints: sorted.map((r) => ({
        date: format(new Date(r.recorded_at), "MMM d"),
        level: r.level_liters!,
        projected: false,
      })),
      hasEnoughData: false,
    }
  }

  const oldest = segment[0]
  const newest = segment[segment.length - 1]

  const totalDays = differenceInDays(
    new Date(newest.recorded_at),
    new Date(oldest.recorded_at)
  )

  if (totalDays <= 0) {
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints: [],
      hasEnoughData: false,
    }
  }

  const totalConsumed = oldest.level_liters! - newest.level_liters!
  const dailyRate = totalConsumed / totalDays

  if (dailyRate <= 0) {
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints: [],
      hasEnoughData: false,
    }
  }

  const currentLevel = newest.level_liters!
  const daysRemaining = Math.floor(currentLevel / dailyRate)
  const runOutDate = addDays(new Date(newest.recorded_at), daysRemaining)

  const historicalPoints: ForecastPoint[] = sorted.map((r) => ({
    date: format(new Date(r.recorded_at), "MMM d"),
    level: r.level_liters!,
    projected: false,
  }))

  const projectedPoints: ForecastPoint[] = []
  const step = Math.max(1, Math.floor(daysRemaining / 10))
  for (let d = step; d <= daysRemaining; d += step) {
    const projectedLevel = Math.max(0, currentLevel - dailyRate * d)
    projectedPoints.push({
      date: format(addDays(new Date(newest.recorded_at), d), "MMM d"),
      level: Math.round(projectedLevel * 10) / 10,
      projected: true,
    })
  }
  projectedPoints.push({
    date: format(runOutDate, "MMM d"),
    level: 0,
    projected: true,
  })

  return {
    dailyRateLiters: Math.round(dailyRate * 10) / 10,
    runOutDate,
    daysRemaining,
    forecastPoints: [...historicalPoints, ...projectedPoints],
    hasEnoughData: true,
  }
}
