"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import {
  computePeriodStats,
  type DayRange,
  type PeriodStats,
  type YearlyLevels,
} from "@/lib/yearly-levels"
import {
  computeForecastPeriod,
  type ForecastPeriod,
  type TimeRange,
} from "@/lib/forecast-period"
import type { ForecastPoint } from "@/lib/predictions"

type YearView = {
  levels: YearlyLevels
  years: number[]
  activeYears: number[]
  toggleYear: (year: number) => void
  selection: DayRange | null
  setSelection: (range: DayRange | null) => void
  period: PeriodStats | null
  forecastPoints: ForecastPoint[]
  forecastSelection: TimeRange | null
  setForecastSelection: (range: TimeRange | null) => void
  forecastPeriod: ForecastPeriod | null
}

const YearViewContext = createContext<YearView | null>(null)

type Selection =
  | { chart: "years"; range: DayRange }
  | { chart: "forecast"; range: TimeRange }

/**
 * Holds the year toggles and the period selected on the year-over-year chart
 * or on the run-out chart. One selection at a time: the tank illustration
 * shows it, and it can show one period only.
 *
 * The state lives here and not in the page so that a drag on a chart
 * re-renders only the charts and the tank illustration, the consumers.
 */
export function YearViewProvider({
  levels,
  forecastPoints,
  children,
}: {
  levels: YearlyLevels
  forecastPoints: ForecastPoint[]
  children: React.ReactNode
}) {
  const [toggled, setToggled] = useState<Set<number> | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const selection = selected?.chart === "years" ? selected.range : null
  const forecastSelection = selected?.chart === "forecast" ? selected.range : null

  const setSelection = useCallback(
    (range: DayRange | null) => setSelected(range && { chart: "years", range }),
    []
  )
  const setForecastSelection = useCallback(
    (range: TimeRange | null) => setSelected(range && { chart: "forecast", range }),
    []
  )

  const years = useMemo(() => levels.byYear.map(([year]) => year), [levels])
  const activeYears = useMemo(
    () => (toggled ? years.filter((year) => toggled.has(year)) : years.slice(-2)),
    [years, toggled]
  )

  const toggleYear = useCallback(
    (year: number) =>
      setToggled((prev) => {
        const next = new Set(prev ?? years.slice(-2))
        if (next.has(year)) next.delete(year)
        else next.add(year)
        return next
      }),
    [years]
  )

  const period = useMemo(
    () =>
      selection && activeYears.length > 0
        ? computePeriodStats(levels.byYear, activeYears, selection)
        : null,
    [levels, activeYears, selection]
  )

  const forecastPeriod = useMemo(
    () => (forecastSelection ? computeForecastPeriod(forecastPoints, forecastSelection) : null),
    [forecastPoints, forecastSelection]
  )

  const value = useMemo(
    () => ({
      levels,
      years,
      activeYears,
      toggleYear,
      selection,
      setSelection,
      period,
      forecastPoints,
      forecastSelection,
      setForecastSelection,
      forecastPeriod,
    }),
    [
      levels,
      years,
      activeYears,
      toggleYear,
      selection,
      setSelection,
      period,
      forecastPoints,
      forecastSelection,
      setForecastSelection,
      forecastPeriod,
    ]
  )

  return <YearViewContext.Provider value={value}>{children}</YearViewContext.Provider>
}

export function useYearView(): YearView {
  const view = useContext(YearViewContext)
  if (!view) throw new Error("useYearView needs a YearViewProvider above it")
  return view
}
