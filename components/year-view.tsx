"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import {
  computePeriodStats,
  type DayRange,
  type PeriodStats,
  type YearlyLevels,
} from "@/lib/yearly-levels"

type YearView = {
  levels: YearlyLevels
  years: number[]
  activeYears: number[]
  toggleYear: (year: number) => void
  selection: DayRange | null
  setSelection: (range: DayRange | null) => void
  period: PeriodStats | null
}

const YearViewContext = createContext<YearView | null>(null)

/**
 * Holds the year toggles and the selected period of the year-over-year chart.
 * The state lives here and not in the page so that a drag on the chart
 * re-renders only the chart and the tank illustration, the two consumers.
 */
export function YearViewProvider({
  levels,
  children,
}: {
  levels: YearlyLevels
  children: React.ReactNode
}) {
  const [toggled, setToggled] = useState<Set<number> | null>(null)
  const [selection, setSelection] = useState<DayRange | null>(null)

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

  const value = useMemo(
    () => ({ levels, years, activeYears, toggleYear, selection, setSelection, period }),
    [levels, years, activeYears, toggleYear, selection, period]
  )

  return <YearViewContext.Provider value={value}>{children}</YearViewContext.Provider>
}

export function useYearView(): YearView {
  const view = useContext(YearViewContext)
  if (!view) throw new Error("useYearView needs a YearViewProvider above it")
  return view
}
