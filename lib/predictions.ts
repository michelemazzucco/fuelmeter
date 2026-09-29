import {
  differenceInDays,
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
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
 * Circular linear interpolation for months with no observed coverage,
 * in place. Covered months keep their rate; empty months are interpolated
 * between the nearest covered neighbours around the year wheel.
 */
function fillEmptyMonths(rawRate: number[], coveredDays: number[]): void {
  for (let m = 0; m < 12; m++) {
    if (coveredDays[m] === 0) {
      let prevM = -1,
        prevSteps = 0
      for (let i = 1; i <= 12; i++) {
        const idx = (m - i + 12) % 12
        if (coveredDays[idx] > 0) {
          prevM = idx
          prevSteps = i
          break
        }
      }
      let nextM = -1,
        nextSteps = 0
      for (let i = 1; i <= 12; i++) {
        const idx = (m + i) % 12
        if (coveredDays[idx] > 0) {
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
}

/**
 * Derives dimensionless seasonal weights (one per calendar month, mean = 1.0)
 * from all available historical consumption data.
 *
 * Each reading interval's consumption is distributed across the calendar
 * months it spans, then per-month rates are normalised. A single flat pass
 * attenuates the seasonal signal (a long Oct–Mar gap smears winter
 * consumption into autumn), so the distribution is iterated to a fixed
 * point: each round redistributes every interval's drop proportionally to
 * the previous round's weights (EM-style), which recovers the true
 * amplitude that flat proration halves.
 *
 * Returns null when there is insufficient coverage (< 6 distinct months),
 * which causes computePrediction to fall back to the flat-rate model.
 */
export function computeMonthlyWeights(readings: Reading[]): number[] | null {
  const withLiters = readings
    .filter((r) => r.level_liters != null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

  const segments = getAllConsumptionSegments(withLiters)

  // Consumption intervals split into calendar-month chunks (computed once)
  type Interval = { drop: number; chunks: { month: number; days: number }[] }
  const intervals: Interval[] = []
  for (const segment of segments) {
    for (let i = 0; i < segment.length - 1; i++) {
      const a = segment[i]
      const b = segment[i + 1]
      if (a.level_liters! <= b.level_liters!) continue // refill or flat — skip

      const dateA = new Date(a.recorded_at)
      const dateB = new Date(b.recorded_at)
      if (differenceInDays(dateB, dateA) <= 0) continue

      const chunks: { month: number; days: number }[] = []
      let cursor = dateA
      while (cursor < dateB) {
        const nextMonthStart = startOfMonth(addMonths(cursor, 1))
        const end = nextMonthStart < dateB ? nextMonthStart : dateB
        const days = differenceInDays(end, cursor)
        if (days > 0) chunks.push({ month: cursor.getMonth(), days })
        cursor = nextMonthStart
      }
      if (chunks.length > 0) {
        intervals.push({ drop: a.level_liters! - b.level_liters!, chunks })
      }
    }
  }

  const coveredDays = Array(12).fill(0)
  for (const iv of intervals) {
    for (const c of iv.chunks) coveredDays[c.month] += c.days
  }
  if (coveredDays.filter((d) => d > 0).length < 6) return null

  let weights: number[] = Array(12).fill(1) // first round == flat proration
  const MAX_ITERATIONS = 10
  const CONVERGENCE_DELTA = 1e-3

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const liters = Array(12).fill(0)
    for (const iv of intervals) {
      const totalWeight = iv.chunks.reduce((s, c) => s + weights[c.month] * c.days, 0)
      if (totalWeight <= 0) continue
      for (const c of iv.chunks) {
        liters[c.month] += (iv.drop * weights[c.month] * c.days) / totalWeight
      }
    }

    const rawRate = Array(12).fill(0)
    for (let m = 0; m < 12; m++) {
      if (coveredDays[m] > 0) rawRate[m] = liters[m] / coveredDays[m]
    }
    fillEmptyMonths(rawRate, coveredDays)

    const mean = rawRate.reduce((s, r) => s + r, 0) / 12
    if (mean <= 0) return null

    // Small floor keeps a near-zero summer month from becoming an absorbing
    // state (weight 0 would never receive consumption again)
    const next = rawRate.map((r) => Math.max(r / mean, 0.01))
    const maxDelta = Math.max(...next.map((w, m) => Math.abs(w - weights[m])))
    weights = next
    if (maxDelta < CONVERGENCE_DELTA) break
  }

  return weights
}

export type TrendModel = {
  weights: number[] | null   // seasonal monthly weights; null → flat rate
  calibratedRate: number     // season-independent L/day; the flat rate when weights is null
}

/**
 * Tank level on each day from `startDate` (index 0) through `days`, floored at 0.
 * Each day burns `calibratedRate × weight[month]`, so the curve bends with the season.
 */
export function projectLevels(
  startLevel: number,
  startDate: Date,
  days: number,
  model: TrendModel
): number[] {
  const levels = [startLevel]
  let level = startLevel
  for (let d = 0; d < days; d++) {
    const weight = model.weights ? model.weights[addDays(startDate, d).getMonth()] : 1
    level = Math.max(0, level - model.calibratedRate * weight)
    levels.push(level)
  }
  return levels
}

/**
 * Seasonal weights plus the blended consumption rate, for callers that only need
 * to age a known level forward. `calibratedRate` is null when the current segment
 * cannot yield a positive rate; `weights` may still be usable for interpolation.
 */
export function computeTrendModel(readings: Reading[]): {
  weights: number[] | null
  calibratedRate: number | null
} {
  const sorted = readings
    .filter((r) => r.level_liters != null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

  const model = computeRateModel(sorted)
  if (model) {
    return { weights: model.weights, calibratedRate: model.blendedCalibratedRate }
  }
  return { weights: computeMonthlyWeights(sorted), calibratedRate: null }
}

export type DailyLevel = { date: Date; liters: number; isReading: boolean }

/**
 * Tank level for every day from the first reading through today.
 *
 * Falling intervals distribute the measured drop across days proportionally to
 * the seasonal monthly weights (a winter day burns more of a long gap than an
 * autumn one), falling back to linear without enough seasonal history. A rising
 * interval is a refill: the tank keeps burning along the trend up to the day
 * before the reading that records it full, then steps up — that reading is the
 * only day the tank is known to be full, so dating the jump there is the only
 * defensible reading of the data. Past the last reading the level is aged
 * forward to today along the same trend.
 */
export function computeDailyHistory(
  readings: Reading[],
  trend: {
    weights: number[] | null
    calibratedRate: number | null
  } = computeTrendModel(readings)
): DailyLevel[] {
  const sorted = readings
    .filter((r) => r.level_liters != null)
    .map((r) => ({ date: startOfDay(new Date(r.recorded_at)), liters: r.level_liters! }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  if (sorted.length === 0) return []

  const { weights, calibratedRate } = trend

  const byDay = new Map<number, DailyLevel>()
  const setPoint = (date: Date, liters: number, isReading: boolean) => {
    const existing = byDay.get(date.getTime())
    if (!existing || isReading) {
      byDay.set(date.getTime(), {
        date,
        liters,
        isReading: isReading || existing?.isReading || false,
      })
    }
  }

  setPoint(sorted[0].date, sorted[0].liters, true)

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const span = differenceInDays(b.date, a.date)
    if (span <= 0) continue

    if (b.liters > a.liters) {
      const preFill =
        calibratedRate != null
          ? projectLevels(a.liters, a.date, span - 1, { weights, calibratedRate })
          : (Array(span).fill(a.liters) as number[])
      for (let d = 0; d < span; d++) {
        setPoint(addDays(a.date, d), preFill[d], d === 0)
      }
      setPoint(b.date, b.liters, true)
    } else if (weights) {
      const dayWeights: number[] = []
      for (let d = 0; d < span; d++) {
        dayWeights.push(weights[addDays(a.date, d).getMonth()])
      }
      const totalWeight = dayWeights.reduce((s, w) => s + w, 0)
      const drop = a.liters - b.liters
      let cumWeight = 0
      for (let d = 0; d <= span; d++) {
        setPoint(
          addDays(a.date, d),
          a.liters - (drop * cumWeight) / totalWeight,
          d === 0 || d === span
        )
        if (d < span) cumWeight += dayWeights[d]
      }
    } else {
      for (let d = 0; d <= span; d++) {
        setPoint(
          addDays(a.date, d),
          a.liters + ((b.liters - a.liters) * d) / span,
          d === 0 || d === span
        )
      }
    }
  }

  const last = sorted[sorted.length - 1]
  const gapDays = differenceInDays(startOfDay(new Date()), last.date)
  if (calibratedRate != null && gapDays > 0) {
    const levels = projectLevels(last.liters, last.date, gapDays, { weights, calibratedRate })
    for (let d = 1; d <= gapDays; d++) {
      setPoint(addDays(last.date, d), levels[d], false)
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
}

export type ConsumptionAverage = {
  dailyLiters: number
  minDailyLiters: number | null
  maxDailyLiters: number | null
  coveredDays: number
}

const YEAR_DAYS = 365
const MIN_COVERAGE_DAYS = 30

/**
 * Litres burnt in `(start, end]`, with the lightest and heaviest day.
 *
 * A refill day is a rise, and the burn hidden underneath it cannot be
 * recovered, so it contributes nothing and is kept out of the extremes — left
 * in, it would report a minimum of zero for every cycle. It still counts
 * towards `days`, which measures elapsed time, not measured time.
 *
 * A day with no drop is kept out of the extremes too: two readings at the same
 * level mean the burn was below the dip-stick's resolution, not zero, and the
 * next reading's drop still carries it into `liters`.
 */
function consumedBetween(
  history: DailyLevel[],
  start: Date,
  end: Date
): { liters: number; days: number; minDaily: number | null; maxDaily: number | null } {
  let liters = 0
  let days = 0
  let minDaily: number | null = null
  let maxDaily: number | null = null

  for (let i = 1; i < history.length; i++) {
    const day = history[i].date
    if (day <= start || day > end) continue
    days++

    const burnt = history[i - 1].liters - history[i].liters
    if (burnt <= 0) continue

    liters += burnt
    minDaily = minDaily === null ? burnt : Math.min(minDaily, burnt)
    maxDaily = maxDaily === null ? burnt : Math.max(maxDaily, burnt)
  }

  return { liters, days, minDaily, maxDaily }
}

/**
 * Rolling 12-month consumption rate. Unlike the run-out card's daily rate, this
 * is a true average over a whole year, so the seasonal weights cancel out.
 *
 * Divides by the days actually covered by readings rather than by a flat 365,
 * so a short history reports the rate it can support instead of one diluted by
 * months that were never measured; `coveredDays` says how wide that window
 * really was. Returns null below a month of coverage.
 */
export function computeAnnualAverage(readings: Reading[]): ConsumptionAverage | null {
  const history = computeDailyHistory(readings)
  if (history.length < 2) return null

  const end = history[history.length - 1].date
  const { liters, days, minDaily, maxDaily } = consumedBetween(
    history,
    addDays(end, -YEAR_DAYS),
    end
  )
  if (days < MIN_COVERAGE_DAYS) return null

  return {
    dailyLiters: liters / days,
    minDailyLiters: minDaily,
    maxDailyLiters: maxDaily,
    coveredDays: days,
  }
}

type RateModel = {
  segment: Reading[]            // current consumption segment, length >= 2
  weights: number[] | null      // seasonal monthly weights; null → flat fallback
  recentDailyRate: number       // raw OLS/endpoint rate of the current segment (L/day)
  blendedCalibratedRate: number // season-independent centre rate; equals recentDailyRate when flat
  rateStdDev: number            // cross-segment 1σ on the calibrated rate; 0 when flat
  fromHistory: boolean          // rate comes only from past segments (e.g. just after a refill)
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length)
}

/**
 * Rate model built only from past segments, used when the current segment
 * cannot yield a rate yet (typically right after a refill).
 * Returns null when there is no usable historical segment.
 */
function historicalRateModel(sorted: Reading[], segment: Reading[]): RateModel | null {
  const weights = computeMonthlyWeights(sorted)
  const allSegments = getAllConsumptionSegments(sorted)
  // A current segment with < 2 readings was never added to allSegments
  const pastSegments = segment.length < 2 ? allSegments : allSegments.slice(0, -1)
  const calibrationWeights = weights ?? Array(12).fill(1)
  const rates = pastSegments
    .map((seg) => segmentCalibratedRate(seg, calibrationWeights))
    .filter((r): r is number => r !== null && r > 0)
  if (rates.length === 0) return null

  const rate = mean(rates)
  return {
    segment,
    weights,
    recentDailyRate: rate,
    blendedCalibratedRate: rate,
    rateStdDev: weights ? stdDev(rates) : 0,
    fromHistory: true,
  }
}

/**
 * Fits the consumption-rate model shared by the forecast and the consumption
 * buckets: current-segment OLS rate, seasonal calibration, historical blending
 * and cross-segment 1σ. When the current segment cannot yield a positive rate
 * (fewer than 2 readings, zero span, or net level gain), falls back to the
 * mean rate of past segments. Returns null when neither is available.
 */
function computeRateModel(sorted: Reading[]): RateModel | null {
  const segment = getLastConsumptionSegment(sorted)
  if (segment.length < 2) return historicalRateModel(sorted, segment)

  const oldest = segment[0]
  const newest = segment[segment.length - 1]

  const totalDays = differenceInDays(
    new Date(newest.recorded_at),
    new Date(oldest.recorded_at)
  )
  if (totalDays <= 0) return historicalRateModel(sorted, segment)

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
  if (recentDailyRate <= 0) return historicalRateModel(sorted, segment)

  const weights = computeMonthlyWeights(sorted)

  if (weights === null) {
    return {
      segment,
      weights: null,
      recentDailyRate,
      blendedCalibratedRate: recentDailyRate,
      rateStdDev: 0,
      fromHistory: false,
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

  return { segment, weights, recentDailyRate, blendedCalibratedRate, rateStdDev, fromHistory: false }
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
  fromHistory: boolean
} {
  // Only readings with known liters are usable for prediction
  const withLiters = readings.filter((r) => r.level_liters != null)

  const sorted = [...withLiters].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  )

  const model = computeRateModel(sorted)
  if (model === null) {
    const segment = getLastConsumptionSegment(sorted)
    return {
      dailyRateLiters: null,
      runOutDate: null,
      daysRemaining: null,
      forecastPoints:
        segment.length < 2
          ? segment.map((r) => ({
              date: new Date(r.recorded_at).getTime(),
              level: r.level_liters!,
              projected: false,
            }))
          : [],
      hasEnoughData: false,
      isSeasonal: false,
      fromHistory: false,
    }
  }
  const { segment, weights, recentDailyRate, blendedCalibratedRate, rateStdDev, fromHistory } =
    model
  const newest = segment[segment.length - 1]

  const historicalPoints: ForecastPoint[] = segment.map((r) => ({
    date: new Date(r.recorded_at).getTime(),
    level: r.level_liters!,
    projected: false,
  }))

  // Age the level from the last reading up to today along the seasonal trend.
  // Carrying it forward flat would start the forecast from a level that never
  // happened, pushing the run-out date months too late.
  const today = startOfDay(new Date())
  const newestDate = startOfDay(new Date(newest.recorded_at))
  const daysSinceLastReading = differenceInDays(today, newestDate)

  let currentLevel = newest.level_liters!
  if (daysSinceLastReading > 0) {
    const gapLevels = projectLevels(currentLevel, newestDate, daysSinceLastReading, {
      weights,
      calibratedRate: blendedCalibratedRate,
    })
    currentLevel = gapLevels[daysSinceLastReading]

    const gapStep = Math.max(1, Math.floor(daysSinceLastReading / 8))
    for (let d = gapStep; d < daysSinceLastReading; d += gapStep) {
      historicalPoints.push({
        date: addDays(newestDate, d).getTime(),
        level: Math.round(gapLevels[d] * 10) / 10,
        projected: false,
      })
    }
    historicalPoints.push({
      date: today.getTime(),
      level: Math.round(currentLevel * 10) / 10,
      projected: false,
    })
  }
  // Projection always starts from today (or the last reading if it's today)
  const projectionStart = daysSinceLastReading > 0 ? today : newestDate

  if (weights === null) {
    // Flat-rate fallback: insufficient seasonal data
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
      fromHistory,
    }
  }

  // ── Seasonal forward projection ───────────────────────────────────────────

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
    fromHistory,
  }
}
