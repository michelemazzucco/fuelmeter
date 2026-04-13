import { differenceInDays, addDays, addMonths, startOfMonth, format } from "date-fns"
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

/**
 * Splits all readings into consumption segments (one per refill cycle).
 * Each segment begins at a refill reading and ends just before the next refill.
 * Segments with fewer than 2 readings are discarded.
 */
function getAllConsumptionSegments(sorted: Reading[]): Reading[][] {
  const segments: Reading[][] = []
  let current: Reading[] = []

  for (const reading of sorted) {
    if (reading.is_refill) {
      if (current.length >= 2) {
        segments.push(current)
      }
      current = [reading]
    } else {
      current.push(reading)
    }
  }

  if (current.length >= 2) {
    segments.push(current)
  }

  return segments
}

/**
 * Derives dimensionless seasonal weights (one per calendar month, mean = 1.0)
 * from all available historical consumption data.
 *
 * Returns null when there is insufficient coverage (< 6 distinct months),
 * which causes computePrediction to fall back to the flat-rate model.
 */
export function computeMonthlyWeights(readings: Reading[]): number[] | null {
  const withLiters = readings
    .filter((r) => r.level_liters != null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

  const segments = getAllConsumptionSegments(withLiters)

  const buckets = Array.from({ length: 12 }, () => ({ totalDays: 0, weightedRateSum: 0 }))

  for (const segment of segments) {
    for (let i = 0; i < segment.length - 1; i++) {
      const a = segment[i]
      const b = segment[i + 1]
      if (a.level_liters! <= b.level_liters!) continue // refill or flat — skip

      const dateA = new Date(a.recorded_at)
      const dateB = new Date(b.recorded_at)
      const intervalDays = differenceInDays(dateB, dateA)
      if (intervalDays <= 0) continue

      const avgRate = (a.level_liters! - b.level_liters!) / intervalDays

      // Distribute this pair's consumption proportionally across calendar months
      let cursor = dateA
      while (cursor < dateB) {
        const nextMonthStart = startOfMonth(addMonths(cursor, 1))
        const end = nextMonthStart < dateB ? nextMonthStart : dateB
        const days = differenceInDays(end, cursor)
        if (days > 0) {
          const m = cursor.getMonth()
          buckets[m].totalDays += days
          buckets[m].weightedRateSum += avgRate * days
        }
        cursor = nextMonthStart
      }
    }
  }

  const coveredMonths = buckets.filter((b) => b.totalDays > 0).length
  if (coveredMonths < 6) return null

  // Compute per-month average rate
  const rawRate: number[] = Array(12).fill(0)
  for (let m = 0; m < 12; m++) {
    if (buckets[m].totalDays > 0) {
      rawRate[m] = buckets[m].weightedRateSum / buckets[m].totalDays
    }
  }

  // Circular linear interpolation for any months with no data
  for (let m = 0; m < 12; m++) {
    if (buckets[m].totalDays === 0) {
      let prevM = -1,
        prevSteps = 0
      for (let i = 1; i <= 12; i++) {
        const idx = (m - i + 12) % 12
        if (buckets[idx].totalDays > 0) {
          prevM = idx
          prevSteps = i
          break
        }
      }
      let nextM = -1,
        nextSteps = 0
      for (let i = 1; i <= 12; i++) {
        const idx = (m + i) % 12
        if (buckets[idx].totalDays > 0) {
          nextM = idx
          nextSteps = i
          break
        }
      }

      if (prevM >= 0 && nextM >= 0) {
        rawRate[m] =
          (rawRate[prevM] * nextSteps + rawRate[nextM] * prevSteps) / (prevSteps + nextSteps)
      } else if (prevM >= 0) {
        rawRate[m] = rawRate[prevM]
      } else if (nextM >= 0) {
        rawRate[m] = rawRate[nextM]
      }
    }
  }

  const mean = rawRate.reduce((s, r) => s + r, 0) / 12
  if (mean <= 0) return null

  return rawRate.map((r) => r / mean)
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
  isSeasonal: boolean
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
      isSeasonal: false,
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
      isSeasonal: false,
    }
  }

  const totalConsumed = oldest.level_liters! - newest.level_liters!
  const recentDailyRate = totalConsumed / totalDays

  if (recentDailyRate <= 0) {
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints: [],
      hasEnoughData: false,
      isSeasonal: false,
    }
  }

  const historicalPoints: ForecastPoint[] = sorted.map((r) => ({
    date: format(new Date(r.recorded_at), "MMM d"),
    level: r.level_liters!,
    projected: false,
  }))

  const weights = computeMonthlyWeights(sorted)

  if (weights === null) {
    // Flat-rate fallback: insufficient seasonal data
    const currentLevel = newest.level_liters!
    const daysRemaining = Math.floor(currentLevel / recentDailyRate)
    const runOutDate = addDays(new Date(newest.recorded_at), daysRemaining)

    const projectedPoints: ForecastPoint[] = []
    const step = Math.max(1, Math.floor(daysRemaining / 10))
    for (let d = step; d <= daysRemaining; d += step) {
      projectedPoints.push({
        date: format(addDays(new Date(newest.recorded_at), d), "MMM d"),
        level: Math.max(0, Math.round((currentLevel - recentDailyRate * d) * 10) / 10),
        projected: true,
      })
    }
    projectedPoints.push({
      date: format(runOutDate, "MMM d"),
      level: 0,
      projected: true,
    })

    return {
      dailyRateLiters: Math.round(recentDailyRate * 10) / 10,
      runOutDate,
      daysRemaining,
      forecastPoints: [...historicalPoints, ...projectedPoints],
      hasEnoughData: true,
      isSeasonal: false,
    }
  }

  // Seasonal projection: apply monthly weights scaled to the recent segment rate
  const currentLevel = newest.level_liters!
  const startDate = new Date(newest.recorded_at)
  const currentMonthWeight = weights[startDate.getMonth()]

  // Step size based on flat-rate estimate so we get ~12 projected points
  const flatDaysEstimate = Math.max(1, Math.floor(currentLevel / recentDailyRate))
  const step = Math.max(7, Math.floor(flatDaysEstimate / 12))

  const projectedPoints: ForecastPoint[] = []
  let level = currentLevel
  let cursor = startDate
  let dayCount = 0
  const MAX_DAYS = 3650 // 10-year safety cap

  while (level > 0 && dayCount < MAX_DAYS) {
    const w = weights[cursor.getMonth()]
    level -= recentDailyRate * w
    cursor = addDays(cursor, 1)
    dayCount++

    if (dayCount % step === 0 || level <= 0) {
      projectedPoints.push({
        date: format(cursor, "MMM d"),
        level: Math.max(0, Math.round(level * 10) / 10),
        projected: true,
      })
    }
  }

  return {
    dailyRateLiters: Math.round(recentDailyRate * currentMonthWeight * 10) / 10,
    runOutDate: cursor,
    daysRemaining: dayCount,
    forecastPoints: [...historicalPoints, ...projectedPoints],
    hasEnoughData: true,
    isSeasonal: true,
  }
}
