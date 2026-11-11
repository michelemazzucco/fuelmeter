import { createTool } from "@mastra/core/tools"
import { differenceInDays, parseISO } from "date-fns"
import { z } from "zod"
import {
  computeConsumptionStats,
  computeDailyHistory,
  computeMonthlyWeights,
  computeTrendModel,
  getAllConsumptionSegments,
} from "../../../../lib/predictions"
import { day, isoDate, loadModelInput, readOnly } from "../context"
import { loadReadings } from "../db"

const MAX_RANGE_DAYS = 400
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const round1 = (n: number) => Math.round(n * 10) / 10

export const getDailyLevels = createTool({
  id: "get_daily_levels",
  description: `Estimated tank level in litres for every day in a range (yyyy-MM-dd, inclusive, at most ${MAX_RANGE_DAYS} days), plus the litres burnt each day. Readings are exact; days between readings share the measured drop by seasonal weights, or by boiler hours where Netatmo data exists. Refill days show a rise and a burn of 0.`,
  mcp: readOnly,
  inputSchema: z.object({ from: isoDate, to: isoDate }),
  outputSchema: z.object({
    days: z.array(
      z.object({ date: z.string(), liters: z.number(), burntLiters: z.number(), isReading: z.boolean() })
    ),
    totalBurntLiters: z.number(),
  }),
  execute: async ({ from, to }) => {
    if (to < from) throw new Error("`to` is before `from`")
    if (differenceInDays(parseISO(to), parseISO(from)) > MAX_RANGE_DAYS) {
      throw new Error(`Range is longer than ${MAX_RANGE_DAYS} days; split it`)
    }
    const { readings, boiler } = await loadModelInput()
    const history = computeDailyHistory(readings, computeTrendModel(readings), boiler)
    const days = history.flatMap((level, i) => {
      const date = day(level.date)
      if (date < from || date > to) return []
      const burnt = i === 0 ? 0 : Math.max(0, history[i - 1].liters - level.liters)
      return [{ date, liters: round1(level.liters), burntLiters: round1(burnt), isReading: level.isReading }]
    })
    return { days, totalBurntLiters: round1(days.reduce((sum, d) => sum + d.burntLiters, 0)) }
  },
})

export const getConsumptionStats = createTool({
  id: "get_consumption_stats",
  description:
    "Consumption summary as shown on the dashboard: average L/day over the last 12 months (only over days covered by readings, see coveredDays), lightest and heaviest day, average L/day over the last 30 days, and litres burnt since the last refill.",
  mcp: readOnly,
  inputSchema: z.object({}),
  outputSchema: z
    .object({
      dailyLiters: z.number(),
      minDailyLiters: z.number().nullable(),
      maxDailyLiters: z.number().nullable(),
      coveredDays: z.number(),
      last30DailyLiters: z.number(),
      sinceRefill: z.object({ liters: z.number(), days: z.number() }).nullable(),
    })
    .nullable(),
  execute: async () => {
    const { readings, boiler } = await loadModelInput()
    const stats = computeConsumptionStats(readings, boiler)
    if (!stats) return null
    const roundOrNull = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)
    return {
      ...stats,
      dailyLiters: round1(stats.dailyLiters),
      minDailyLiters: roundOrNull(stats.minDailyLiters),
      maxDailyLiters: roundOrNull(stats.maxDailyLiters),
      last30DailyLiters: round1(stats.last30DailyLiters),
      sinceRefill: stats.sinceRefill && { liters: round1(stats.sinceRefill.liters), days: stats.sinceRefill.days },
    }
  },
})

export const listConsumptionCycles = createTool({
  id: "list_consumption_cycles",
  description:
    "One entry per refill cycle (from a refill to the last reading before the next refill), oldest first: start and end dates, start and end level in litres, litres burnt, days, and average L/day. The last cycle is the one in progress. Useful to compare whole winters or years.",
  mcp: readOnly,
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      startLiters: z.number(),
      endLiters: z.number(),
      burntLiters: z.number(),
      days: z.number(),
      litersPerDay: z.number().nullable(),
      readings: z.number(),
    })
  ),
  execute: async () => {
    const sorted = (await loadReadings()).filter((r) => r.level_liters != null)
    return getAllConsumptionSegments(sorted).map((segment) => {
      const first = segment[0]
      const last = segment[segment.length - 1]
      const days = differenceInDays(new Date(last.recorded_at), new Date(first.recorded_at))
      const burnt = first.level_liters! - last.level_liters!
      return {
        start: day(first.recorded_at),
        end: day(last.recorded_at),
        startLiters: first.level_liters!,
        endLiters: last.level_liters!,
        burntLiters: round1(burnt),
        days,
        litersPerDay: days > 0 ? round1(burnt / days) : null,
        readings: segment.length,
      }
    })
  },
})

export const getSeasonalWeights = createTool({
  id: "get_seasonal_weights",
  description:
    "Monthly consumption weights derived from all past cycles, averaging 1.0: a month with weight 1.8 burns 1.8× the average day. Null when the history covers fewer than 6 months. calibratedDailyLiters is the season-independent L/day; month burn ≈ calibratedDailyLiters × weight.",
  mcp: readOnly,
  inputSchema: z.object({}),
  outputSchema: z.object({
    weights: z.array(z.object({ month: z.string(), weight: z.number() })).nullable(),
    calibratedDailyLiters: z.number().nullable(),
  }),
  execute: async () => {
    const readings = await loadReadings()
    const weights = computeMonthlyWeights(readings)
    const { calibratedRate } = computeTrendModel(readings)
    return {
      weights: weights?.map((weight, i) => ({ month: MONTHS[i], weight: Math.round(weight * 100) / 100 })) ?? null,
      calibratedDailyLiters: calibratedRate == null ? null : round1(calibratedRate),
    }
  },
})
