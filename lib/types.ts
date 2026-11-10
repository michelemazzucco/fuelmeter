export type Reading = {
  id: string
  recorded_at: string
  level_cm: number | null
  level_liters: number | null
  is_refill: boolean
  notes: string | null
  created_at: string
}

export type TankConfig = {
  id: string
  capacity_liters: number
  low_threshold_liters: number
  updated_at: string
}

export type BoilerDay = {
  day: string   // yyyy-MM-dd, local to the home
  hours: number // boiler-on time that day
}

export type BoilerPeriod = {
  start: string // yyyy-MM-dd of the period's first day (weeks start on Monday)
  hours: number
  days: number  // days with data in the period
}

/**
 * Daily values only reach a logged-in viewer: day-by-day boiler use shows
 * when the house is empty. Anonymous viewers get weekly and monthly totals.
 */
export type BoilerHours =
  | { resolution: "day"; days: BoilerDay[] }
  | { resolution: "week"; weeks: BoilerPeriod[]; months: BoilerPeriod[] }

export type BoilerSyncStatus = {
  status: "ok" | "skipped" | "not-configured" | "error"
  added: number
  lastSyncAt: string | null
  error?: string
}
