import {
  differenceInDays,
  addDays,
  addMonths,
  startOfMonth,
  startOfDay,
  startOfISOWeek,
  eachDayOfInterval,
} from "date-fns"
import type { Reading } from "./types"

export type ForecastPoint = {
  date: number        // Unix timestamp (ms) — used as numeric X axis
  level: number
  projected: boolean
  levelLow?: number   // pessimistic: +1σ consumption rate (runs out sooner)
  levelHigh?: number  // optimistic:  −1σ consumption rate (runs out later)
}

/**
 * Finds the most recent consumption segment by locating the last refill reading.
 * Falls back to the last level increase for data without is_refill flags.
 */
function getLastConsumptionSegment(readings: Reading[]): Reading[] {
  if (readings.length < 2) return readings

  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i].is_refill) return readings.slice(i)
  }

  // Fallback: detect refill by level increase
  for (let i = readings.length - 1; i > 0; i--) {
    if (readings[i].level_liters! > readings[i - 1].level_liters!) {
      return readings.slice(i)
    }
  }

  return readings
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
 * OLS linear regression on paired (x, y) observations.
 * Returns slope, intercept, and residual standard error.
 * Returns null if fewer than 2 points or zero x-variance.
 */
function olsRegression(
  xs: number[],
  ys: number[]
): {
  slope: number
  intercept: number
  residualStdErr: number
  sxx: number
  xMean: number
  n: number
} | null {
  const n = xs.length
  if (n < 2) return null

  const xMean = xs.reduce((s, x) => s + x, 0) / n
  const yMean = ys.reduce((s, y) => s + y, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - xMean) ** 2
    sxy += (xs[i] - xMean) * (ys[i] - yMean)
  }
  if (sxx === 0) return null

  const slope = sxy / sxx
  const intercept = yMean - slope * xMean

  let sse = 0
  for (let i = 0; i < n; i++) {
    sse += (ys[i] - (slope * xs[i] + intercept)) ** 2
  }
  const residualStdErr = n > 2 ? Math.sqrt(sse / (n - 2)) : 0

  return { slope, intercept, residualStdErr, sxx, xMean, n }
}

/**
 * Computes the average seasonal weight over a date range.
 * Used to normalise a segment's raw rate to a season-independent calibrated rate.
 */
function averageWeight(weights: number[], start: Date, end: Date): number {
  let weightedSum = 0
  let totalDays = 0
  let cursor = start
  while (cursor < end) {
    const nextMonth = startOfMonth(addMonths(cursor, 1))
    const segEnd = nextMonth < end ? nextMonth : end
    const days = differenceInDays(segEnd, cursor)
    if (days > 0) {
      weightedSum += weights[cursor.getMonth()] * days
      totalDays += days
    }
    cursor = nextMonth
  }
  return totalDays > 0 ? weightedSum / totalDays : 1
}

/**
 * Computes the calibrated annual daily rate for a segment via OLS.
 * Divides the OLS consumption rate by the average seasonal weight of the
 * segment, yielding a season-independent rate (litres/day at mean seasonal load).
 * Returns null if the segment has insufficient data or is not net-consuming.
 */
function segmentCalibratedRate(segment: Reading[], weights: number[]): number | null {
  if (segment.length < 2) return null
  const t0 = new Date(segment[0].recorded_at)
  const xs = segment.map((r) => differenceInDays(new Date(r.recorded_at), t0))
  const ys = segment.map((r) => r.level_liters!)
  const ols = olsRegression(xs, ys)
  if (!ols || ols.slope >= 0) return null

  const rawRate = -ols.slope
  const segEnd = new Date(segment[segment.length - 1].recorded_at)
  const avgW = averageWeight(weights, t0, segEnd)
  return rawRate / avgW
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

type RateModel = {
  segment: Reading[]            // current consumption segment, length >= 2
  weights: number[] | null      // seasonal monthly weights; null → flat fallback
  recentDailyRate: number       // raw OLS/endpoint rate of the current segment (L/day)
  blendedCalibratedRate: number // season-independent centre rate; equals recentDailyRate when flat
  rateStdDev: number            // cross-segment 1σ on the calibrated rate; 0 when flat
}

/**
 * Fits the consumption-rate model shared by the forecast and the consumption
 * buckets: current-segment OLS rate, seasonal calibration, historical blending
 * and cross-segment 1σ. Returns null when the current segment cannot yield a
 * positive rate (fewer than 2 readings, zero span, or net level gain).
 */
function computeRateModel(sorted: Reading[]): RateModel | null {
  const segment = getLastConsumptionSegment(sorted)
  if (segment.length < 2) return null

  const oldest = segment[0]
  const newest = segment[segment.length - 1]

  const totalDays = differenceInDays(
    new Date(newest.recorded_at),
    new Date(oldest.recorded_at)
  )
  if (totalDays <= 0) return null

  // OLS regression through all readings in the current segment.
  // More robust than endpoint-to-endpoint when intermediate readings contain noise.
  const t0 = new Date(oldest.recorded_at)
  const segXs = segment.map((r) => differenceInDays(new Date(r.recorded_at), t0))
  const segYs = segment.map((r) => r.level_liters!)
  const segOls = olsRegression(segXs, segYs)

  // Fall back to endpoint rate if OLS fails or implies a net gain (post-refill noise)
  const endpointRate = (oldest.level_liters! - newest.level_liters!) / totalDays
  const recentDailyRate =
    segOls && segOls.slope < 0 ? -segOls.slope : endpointRate
  if (recentDailyRate <= 0) return null

  const weights = computeMonthlyWeights(sorted)

  if (weights === null) {
    return {
      segment,
      weights: null,
      recentDailyRate,
      blendedCalibratedRate: recentDailyRate,
      rateStdDev: 0,
    }
  }

  // Average seasonal weight over the current segment, used to convert the
  // raw OLS rate into a season-independent calibrated rate (L/day at mean load).
  const avgSegmentWeight = averageWeight(weights, t0, new Date(newest.recorded_at))
  const currentCalibratedRate = recentDailyRate / avgSegmentWeight

  const allSegments = getAllConsumptionSegments(sorted)
  const historicalSegments = allSegments.slice(0, -1) // all complete segments before current
  const historicalRates = historicalSegments
    .map((seg) => segmentCalibratedRate(seg, weights))
    .filter((r): r is number => r !== null && r > 0)

  // Blending: trust OLS fully after 90 days, blend with historical mean before
  let blendedCalibratedRate = currentCalibratedRate
  if (historicalRates.length >= 1 && totalDays < 90) {
    const histMean = historicalRates.reduce((s, r) => s + r, 0) / historicalRates.length
    const alpha = totalDays / 90
    blendedCalibratedRate = alpha * currentCalibratedRate + (1 - alpha) * histMean
  }

  // Uncertainty: 1σ from cross-segment rate distribution
  const allRates = [...historicalRates, currentCalibratedRate]
  let rateStdDev = 0
  if (allRates.length >= 2) {
    const mean = allRates.reduce((s, r) => s + r, 0) / allRates.length
    rateStdDev = Math.sqrt(allRates.reduce((s, r) => s + (r - mean) ** 2, 0) / allRates.length)
  }

  return { segment, weights, recentDailyRate, blendedCalibratedRate, rateStdDev }
}

export type ConsumptionBucket = {
  periodStart: number // ms timestamp: startOfDay (daily) or startOfISOWeek (weekly)
  days: number        // days covered (1 for daily; 1–7 for weekly, partial weeks included)
  low: number         // litres, clamped >= 0, rounded to 0.1
  mid: number
  high: number
  measured: boolean   // true when derived from an actual reading interval
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Buckets estimated consumption over the current segment (last refill → today)
 * by day or ISO week. Days bracketed by consecutive readings use the measured
 * interval-average rate (tighter ±0.5σ band); uncovered days use the seasonal
 * model estimate ±1σ. Returns null when no positive rate can be derived.
 */
export function computeConsumptionBuckets(
  readings: Reading[],
  granularity: "daily" | "weekly"
): ConsumptionBucket[] | null {
  const withLiters = readings.filter((r) => r.level_liters != null)
  const sorted = [...withLiters].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  )

  const model = computeRateModel(sorted)
  if (model === null) return null
  const { segment, weights, blendedCalibratedRate, rateStdDev } = model

  // Measured intervals: consecutive segment pairs with a level drop.
  // Pairs with no drop or zero span fall through to the model estimate.
  const intervals: { start: number; end: number; rate: number }[] = []
  for (let i = 0; i < segment.length - 1; i++) {
    const a = segment[i]
    const b = segment[i + 1]
    const dayA = startOfDay(new Date(a.recorded_at))
    const dayB = startOfDay(new Date(b.recorded_at))
    const d = differenceInDays(dayB, dayA)
    if (d <= 0 || a.level_liters! <= b.level_liters!) continue
    intervals.push({
      start: dayA.getTime(),
      end: dayB.getTime(),
      rate: (a.level_liters! - b.level_liters!) / d,
    })
  }

  const allDays = eachDayOfInterval({
    start: startOfDay(new Date(segment[0].recorded_at)),
    end: startOfDay(new Date()),
  })

  const daily: ConsumptionBucket[] = allDays.map((day) => {
    const t = day.getTime()
    const w = weights ? weights[day.getMonth()] : 1
    const interval = intervals.find((iv) => t >= iv.start && t < iv.end)
    const measured = interval !== undefined
    const mid = Math.max(0, measured ? interval.rate : blendedCalibratedRate * w)
    // Measured periods keep half the cross-segment band; floor keeps bars visible
    const sigma = rateStdDev * w * (measured ? 0.5 : 1)
    const half = Math.max(sigma, mid * 0.02)
    return {
      periodStart: t,
      days: 1,
      low: round1(Math.max(0, mid - half)),
      mid: round1(mid),
      high: round1(mid + half),
      measured,
    }
  })

  if (granularity === "daily") return daily

  // Weekly: sum daily lows/mids/highs per ISO week (fully-correlated errors,
  // matching how the forecast band accumulates σ day by day).
  const byWeek = new Map<number, ConsumptionBucket>()
  for (const d of daily) {
    const wk = startOfISOWeek(new Date(d.periodStart)).getTime()
    const acc = byWeek.get(wk)
    if (!acc) {
      byWeek.set(wk, { ...d, periodStart: wk })
    } else {
      acc.days += 1
      acc.low = round1(acc.low + d.low)
      acc.mid = round1(acc.mid + d.mid)
      acc.high = round1(acc.high + d.high)
      acc.measured = acc.measured && d.measured
    }
  }
  return [...byWeek.values()].sort((a, b) => a.periodStart - b.periodStart)
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
      forecastPoints: segment.map((r) => ({
        date: new Date(r.recorded_at).getTime(),
        level: r.level_liters!,
        projected: false,
      })),
      hasEnoughData: false,
      isSeasonal: false,
    }
  }

  const newest = segment[segment.length - 1]

  const model = computeRateModel(sorted)
  if (model === null) {
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints: [],
      hasEnoughData: false,
      isSeasonal: false,
    }
  }
  const { weights, recentDailyRate, blendedCalibratedRate, rateStdDev } = model

  const historicalPoints: ForecastPoint[] = segment.map((r) => ({
    date: new Date(r.recorded_at).getTime(),
    level: r.level_liters!,
    projected: false,
  }))

  // Extend the actual line to today if the last reading is in the past
  const today = new Date()
  const newestDate = new Date(newest.recorded_at)
  const daysSinceLastReading = differenceInDays(today, newestDate)
  if (daysSinceLastReading > 0) {
    historicalPoints.push({
      date: today.getTime(),
      level: newest.level_liters!,
      projected: false,
    })
  }
  // Projection always starts from today (or the last reading if it's today)
  const projectionStart = daysSinceLastReading > 0 ? today : newestDate

  if (weights === null) {
    // Flat-rate fallback: insufficient seasonal data
    const currentLevel = newest.level_liters!
    const daysRemaining = Math.floor(currentLevel / recentDailyRate)
    const runOutDate = addDays(projectionStart, daysRemaining)

    const projectedPoints: ForecastPoint[] = []
    const step = Math.max(1, Math.floor(daysRemaining / 10))
    for (let d = step; d <= daysRemaining; d += step) {
      projectedPoints.push({
        date: addDays(projectionStart, d).getTime(),
        level: Math.max(0, Math.round((currentLevel - recentDailyRate * d) * 10) / 10),
        projected: true,
      })
    }
    projectedPoints.push({
      date: runOutDate.getTime(),
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

  // ── Seasonal forward projection ───────────────────────────────────────────

  const currentLevel = newest.level_liters!
  const startDate = projectionStart
  const currentMonthWeight = weights[startDate.getMonth()]

  // Step size targets ~12 projected chart points
  const flatDaysEstimate = Math.max(1, Math.floor(currentLevel / recentDailyRate))
  const step = Math.max(7, Math.floor(flatDaysEstimate / 12))

  // Pessimistic (more consumption) and optimistic (less consumption) rates
  const rateLow = Math.max(blendedCalibratedRate + rateStdDev, 0.01)
  const rateHigh = Math.max(blendedCalibratedRate - rateStdDev, 0.01)
  const hasUncertainty = rateStdDev > 0

  const projectedPoints: ForecastPoint[] = []
  let level = currentLevel
  let levelLow = currentLevel
  let levelHigh = currentLevel
  let cursor = startDate
  let dayCount = 0
  const MAX_DAYS = 3650 // 10-year safety cap

  while (level > 0 && dayCount < MAX_DAYS) {
    const w = weights[cursor.getMonth()]
    level -= blendedCalibratedRate * w
    levelLow -= rateLow * w
    levelHigh -= rateHigh * w
    cursor = addDays(cursor, 1)
    dayCount++

    if (dayCount % step === 0 || level <= 0) {
      projectedPoints.push({
        date: cursor.getTime(),
        level: Math.max(0, Math.round(level * 10) / 10),
        projected: true,
        levelLow: hasUncertainty ? Math.max(0, Math.round(levelLow * 10) / 10) : undefined,
        levelHigh: hasUncertainty ? Math.max(0, Math.round(levelHigh * 10) / 10) : undefined,
      })
    }
  }

  return {
    dailyRateLiters: Math.round(blendedCalibratedRate * currentMonthWeight * 10) / 10,
    runOutDate: cursor,
    daysRemaining: dayCount,
    forecastPoints: [...historicalPoints, ...projectedPoints],
    hasEnoughData: true,
    isSeasonal: true,
  }
}
