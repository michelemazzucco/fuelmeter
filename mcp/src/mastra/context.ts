import { format } from "date-fns"
import { z } from "zod"
import { boilerDaysOf, buildBoilerContext } from "../../../lib/heating"
import { loadBoilerHours, loadConfig, loadReadings } from "./db"

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-MM-dd")

export const readOnly = {
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const day = (date: Date | number | string) => format(new Date(date), "yyyy-MM-dd")

export async function loadModelInput() {
  const [readings, config, boilerHours] = await Promise.all([
    loadReadings(),
    loadConfig(),
    loadBoilerHours(),
  ])
  const boilerDays = boilerDaysOf(boilerHours)
  return { readings, config, boilerDays, boiler: buildBoilerContext(readings, boilerDays) ?? undefined }
}
