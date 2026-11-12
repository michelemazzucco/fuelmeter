import { createTool } from "@mastra/core/tools"
import { z } from "zod"
import { BURNER_LITERS_PER_HOUR } from "../../../../lib/heating"
import { isoDate, loadModelInput, readOnly } from "../context"
import { loadBoilerHours } from "../db"

const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000

export const getBoilerHours = createTool({
  id: "get_boiler_hours",
  description:
    "Hours the oil boiler was on, from the Netatmo thermostat, per week (starting Monday) or month, oldest first. Daily values are not available, and the week in progress is left out. Filter by period start (yyyy-MM-dd, inclusive). `days` is how many days in the period have data. Empty when Netatmo is not connected.",
  mcp: readOnly,
  inputSchema: z.object({
    resolution: z.enum(["week", "month"]).default("week"),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }),
  outputSchema: z.object({
    periods: z.array(z.object({ start: z.string(), hours: z.number(), days: z.number() })),
    totalHours: z.number(),
  }),
  execute: async ({ resolution, from, to }) => {
    const hours = await loadBoilerHours()
    const periods = (resolution === "week" ? hours.weeks : hours.months).filter(
      (p) => (!from || p.start >= from) && (!to || p.start <= to)
    )
    return {
      periods: periods.map((p) => ({ ...p, hours: round1(p.hours) })),
      totalHours: round1(periods.reduce((sum, p) => sum + p.hours, 0)),
    }
  },
})

export const getBoilerModel = createTool({
  id: "get_boiler_model",
  description:
    "Fitted relation between boiler hours and oil burnt: daily burn = baseLitersPerDay (hot water and standby, heating off) + litersPerHour × boiler-on hours. `fitted` is false when the base comes from the lightest seasonal month instead of a regression. litersPerHour never exceeds burnerLitersPerHour, the burner's real oil flow, because the thermostat counts heat-demand hours and the burner fires for only part of them. When cappedAtBurnerFlow is true, the litres above that limit are in baseLitersPerDay, so the base is then more than hot water and standby. nearTermCorrection is the last 14 days' burn ÷ what the season predicts (1 = on season). Null when there is not enough boiler data yet.",
  mcp: readOnly,
  inputSchema: z.object({}),
  outputSchema: z
    .object({
      baseLitersPerDay: z.number(),
      litersPerHour: z.number(),
      burnerLitersPerHour: z.number(),
      cappedAtBurnerFlow: z.boolean(),
      fitted: z.boolean(),
      intervals: z.number(),
      nearTermCorrection: z.number(),
      daysWithBoilerData: z.number(),
    })
    .nullable(),
  execute: async () => {
    const { boiler, boilerDays } = await loadModelInput()
    if (!boiler) return null
    return {
      baseLitersPerDay: round3(boiler.model.baseLitersPerDay),
      litersPerHour: round3(boiler.model.litersPerHour),
      burnerLitersPerHour: round3(BURNER_LITERS_PER_HOUR),
      cappedAtBurnerFlow: boiler.model.litersPerHour >= BURNER_LITERS_PER_HOUR,
      fitted: boiler.model.fitted,
      intervals: boiler.model.intervals,
      nearTermCorrection: round3(boiler.correction),
      daysWithBoilerData: boilerDays.length,
    }
  },
})
