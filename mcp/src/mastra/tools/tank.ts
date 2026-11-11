import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { computePrediction } from "../../../../lib/predictions"
import { cmToLiters, TANK_MAX_CM } from "../../../../lib/tank-lookup"
import { day, isoDate, loadModelInput, readOnly } from "../context"
import { loadReadings } from "../db"

const reading = z.object({
  date: z.string(),
  levelCm: z.number().nullable(),
  levelLiters: z.number().nullable(),
  isRefill: z.boolean(),
  notes: z.string().nullable(),
})

const round1 = (n: number) => Math.round(n * 10) / 10

export const getTankStatus = createTool({
  id: "get_tank_status",
  description:
    "Current state of the home heating-oil (diesel) tank: capacity and low threshold in litres, the latest dip-stick reading, the level estimated for today (the latest reading aged forward along the consumption model), percent full and whether it is below the low threshold.",
  mcp: readOnly,
  inputSchema: z.object({}),
  outputSchema: z.object({
    capacityLiters: z.number(),
    lowThresholdLiters: z.number(),
    latestReading: reading.nullable(),
    estimatedLitersToday: z.number().nullable(),
    percentFull: z.number().nullable(),
    belowThreshold: z.boolean().nullable(),
  }),
  execute: async () => {
    const { readings, config, boiler } = await loadModelInput()
    const latest = readings.findLast((r) => r.level_liters != null)
    const prediction = computePrediction(readings, config.capacity_liters, boiler)
    const today = prediction.forecastPoints.findLast((p) => !p.projected)?.level ?? null
    const liters = prediction.estimatedLevelToday ?? today ?? latest?.level_liters ?? null
    return {
      capacityLiters: config.capacity_liters,
      lowThresholdLiters: config.low_threshold_liters,
      latestReading: latest
        ? {
            date: day(latest.recorded_at),
            levelCm: latest.level_cm,
            levelLiters: latest.level_liters,
            isRefill: latest.is_refill,
            notes: latest.notes,
          }
        : null,
      estimatedLitersToday: liters == null ? null : round1(liters),
      percentFull: liters == null ? null : round1((liters / config.capacity_liters) * 100),
      belowThreshold: liters == null ? null : liters < config.low_threshold_liters,
    }
  },
})

export const getForecast = createTool({
  id: "get_forecast",
  description:
    "Run-out forecast, identical to the dashboard: run-out date, days remaining, current daily burn in L/day, and how it was computed (seasonal monthly weights, boiler-hours adjustment, rate borrowed from past cycles). Set includePoints to also get the projected level curve in litres, with a pessimistic (levelLow, +1σ burn) and optimistic (levelHigh, −1σ burn) band.",
  mcp: readOnly,
  inputSchema: z.object({
    includePoints: z.boolean().default(false),
  }),
  outputSchema: z.object({
    hasEnoughData: z.boolean(),
    runOutDate: z.string().nullable(),
    daysRemaining: z.number().nullable(),
    dailyRateLiters: z.number().nullable(),
    isSeasonal: z.boolean(),
    rateFromPastCycles: z.boolean(),
    boilerAdjusted: z.boolean(),
    estimatedLitersToday: z.number().nullable(),
    litersSinceReading: z.number().nullable(),
    boilerHoursSinceReading: z.number().nullable(),
    points: z
      .array(
        z.object({
          date: z.string(),
          liters: z.number(),
          projected: z.boolean(),
          litersLow: z.number().nullable(),
          litersHigh: z.number().nullable(),
        })
      )
      .optional(),
  }),
  execute: async ({ includePoints }) => {
    const { readings, config, boiler } = await loadModelInput()
    const p = computePrediction(readings, config.capacity_liters, boiler)
    return {
      hasEnoughData: p.hasEnoughData,
      runOutDate: p.runOutDate ? day(p.runOutDate) : null,
      daysRemaining: p.daysRemaining,
      dailyRateLiters: p.dailyRateLiters,
      isSeasonal: p.isSeasonal,
      rateFromPastCycles: p.fromHistory,
      boilerAdjusted: p.boilerAdjusted,
      estimatedLitersToday: p.estimatedLevelToday == null ? null : round1(p.estimatedLevelToday),
      litersSinceReading: p.litersSinceReading == null ? null : round1(p.litersSinceReading),
      boilerHoursSinceReading:
        p.boilerHoursSinceReading == null ? null : round1(p.boilerHoursSinceReading),
      points: includePoints
        ? p.forecastPoints.map((point) => ({
            date: day(point.date),
            liters: point.level,
            projected: point.projected,
            litersLow: point.levelLow ?? null,
            litersHigh: point.levelHigh ?? null,
          }))
        : undefined,
    }
  },
})

export const listReadings = createTool({
  id: "list_readings",
  description:
    "Dip-stick readings of the tank, newest first. Each has the date, level in cm and litres (litres derived from the tank calibration table), whether it records a refill, and notes. Filter by date range (yyyy-MM-dd, inclusive) or refills only.",
  mcp: readOnly,
  inputSchema: z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    refillsOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  outputSchema: z.object({ total: z.number(), readings: z.array(reading) }),
  execute: async ({ from, to, refillsOnly, limit }) => {
    const matching = (await loadReadings())
      .map((r) => ({
        date: day(r.recorded_at),
        levelCm: r.level_cm,
        levelLiters: r.level_liters,
        isRefill: r.is_refill,
        notes: r.notes,
      }))
      .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!refillsOnly || r.isRefill))
      .reverse()
    return { total: matching.length, readings: matching.slice(0, limit) }
  },
})

export const convertCmToLiters = createTool({
  id: "convert_cm_to_liters",
  description: `Converts a dip-stick depth in cm to litres with the tank manufacturer's calibration table (0–${TANK_MAX_CM} cm, linear between whole cm).`,
  mcp: readOnly,
  inputSchema: z.object({ cm: z.number().min(0).max(TANK_MAX_CM) }),
  outputSchema: z.object({ cm: z.number(), liters: z.number() }),
  execute: async ({ cm }) => ({ cm, liters: round1(cmToLiters(cm)) }),
})
