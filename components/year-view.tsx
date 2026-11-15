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
  /** The latest year, always shown, after the year it is compared with (if any). */
  activeYears: number[]
  compareYear: number | null
  setCompareYear: (year: number | null) => void
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
 * Holds the compared year and the period selected on the year-over-year chart
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
  const [compare, setCompare] = useState<number | null | undefined>(undefined)
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
  const latestYear = years[years.length - 1]
  // Until the user picks, the latest year is compared with the one before it.
  const picked = compare === undefined ? (years[years.length - 2] ?? null) : compare
  const compareYear = picked !== null && picked !== latestYear && years.includes(picked) ? picked : null
  const activeYears = useMemo(
    () => (compareYear === null ? years.slice(-1) : [compareYear, latestYear]),
    [years, compareYear, latestYear]
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
      compareYear,
      setCompareYear: setCompare,
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
      compareYear,
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
