"use client"

import { useMemo, useState } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts"
import { addDays, differenceInDays, endOfYear, format, getDayOfYear } from "date-fns"
import { cn } from "@/lib/utils"
import { LeaderRow } from "@/components/paper"
import {
  computeDailyHistory,
  computeTrendModel,
  projectLevels,
} from "@/lib/predictions"
import type { Reading } from "@/lib/types"

interface YearlyLevelChartProps {
  readings: Reading[]
  className?: string
}

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]

// Month-start day-of-year ticks (non-leap reference year)
const MONTH_START_DAYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

// Ink + dash pairs assigned per year, most recent first. The dash pattern is
// a secondary encoding so year identity never rests on color alone.
const SERIES_STYLES = [
  { color: "var(--foreground)", dash: undefined },
  { color: "var(--chart-1)", dash: undefined },
  { color: "var(--chart-3)", dash: undefined },
  { color: "var(--foreground)", dash: "5 4" },
  { color: "var(--chart-1)", dash: "5 4" },
  { color: "var(--chart-3)", dash: "5 4" },
]

// Style follows the year itself (not its position in the active set), so
// toggling years never repaints the survivors.
const styleForYear = (latestYear: number, year: number) =>
  SERIES_STYLES[Math.max(0, Math.min(latestYear - year, SERIES_STYLES.length - 1))]

const dayOfYearLabel = (day: number) =>
  format(addDays(new Date(2001, 0, 1), day - 1), "d MMM").toUpperCase()

/** Square markers on actual readings only — the rest of the line is interpolated. */
function readingDot(color: string, year: number) {
  return function Dot(props: {
    cx?: number
    cy?: number
    index?: number
    payload?: Record<string, unknown>
  }) {
    const { cx, cy, index, payload } = props
    if (cx == null || cy == null || !payload?.[`r${year}`]) {
      return <g key={`dot-${year}-${index}`} />
    }
    return (
      <rect
        key={`dot-${year}-${index}`}
        x={cx - 1.5}
        y={cy - 1.5}
        width={3}
        height={3}
        fill={color}
      />
    )
  }
}

/**
 * `computeDailyHistory` sliced per calendar year for the day-of-year axis,
 * plus a forecast series running from the last known day to the run-out date,
 * clipped at 31 December — past that the day-of-year would wrap and draw back
 * over the same line.
 *
 * The forecast is kept out of `byYear` so it never reaches the year stats.
 */
function computeDailyLevels(readings: Reading[]) {
  const trend = computeTrendModel(readings)
  const history = computeDailyHistory(readings, trend)

  const byYear = new Map<number, DayLevels>()
  for (const point of history) {
    const year = point.date.getFullYear()
    const days = byYear.get(year) ?? new Map()
    days.set(getDayOfYear(point.date), { liters: point.liters, isReading: point.isReading })
    byYear.set(year, days)
  }

  let projection: { year: number; days: Map<number, number> } | null = null
  const last = history[history.length - 1]
  if (last && trend.calibratedRate != null) {
    const tailDays = differenceInDays(endOfYear(last.date), last.date)
    const levels = projectLevels(last.liters, last.date, tailDays, {
      weights: trend.weights,
      calibratedRate: trend.calibratedRate,
    })
    const days = new Map<number, number>()
    for (let d = 0; d <= tailDays; d++) {
      days.set(getDayOfYear(addDays(last.date, d)), levels[d])
      if (levels[d] <= 0) break
    }
    projection = { year: last.date.getFullYear(), days }
  }

  return {
    byYear: [...byYear.entries()].sort(([a], [b]) => a - b),
    projection,
  }
}

type DayLevels = Map<number, { liters: number; isReading: boolean }>

/** Litres consumed from the first covered day up to `throughDay` (drops only — refill rises don't count). */
function consumedThrough(days: DayLevels, throughDay: number): number {
  const sorted = [...days.keys()].filter((d) => d <= throughDay).sort((a, b) => a - b)
  let sum = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = days.get(sorted[i])!.liters
    const b = days.get(sorted[i + 1])!.liters
    if (b < a) sum += a - b
  }
  return sum
}

type YearStats = {
  currentYear: number
  consumedYtd: number
  prevYear: number | null
  vsPrevPct: number | null
  levelDiff: number | null
}

/** Current year vs previous year, compared over the same portion of the year. */
function computeYearStats(byYear: [number, DayLevels][]): YearStats | null {
  if (byYear.length === 0) return null
  const [currentYear, curDays] = byYear[byYear.length - 1]
  const curLast = Math.max(...curDays.keys())

  const stats: YearStats = {
    currentYear,
    consumedYtd: consumedThrough(curDays, curLast),
    prevYear: null,
    vsPrevPct: null,
    levelDiff: null,
  }

  const prevEntry = byYear.find(([y]) => y === currentYear - 1)
  if (!prevEntry) return stats
  const [prevYear, prevDays] = prevEntry
  stats.prevYear = prevYear

  // Consumption compared over the days both years cover
  const through = Math.min(curLast, Math.max(...prevDays.keys()))
  const curSame = consumedThrough(curDays, through)
  const prevSame = consumedThrough(prevDays, through)
  if (prevSame > 0) {
    stats.vsPrevPct = ((curSame - prevSame) / prevSame) * 100
  }

  // Tank level today vs the same day last year
  const prevSameDay = [...prevDays.keys()]
    .filter((d) => d <= curLast)
    .sort((a, b) => b - a)[0]
  if (prevSameDay !== undefined) {
    stats.levelDiff = curDays.get(curLast)!.liters - prevDays.get(prevSameDay)!.liters
  }

  return stats
}

const signed = (v: number, unit: string) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}${unit}`

export function YearlyLevelChart({ readings, className }: YearlyLevelChartProps) {
  const { years, chartData, stats, projectionYear } = useMemo(() => {
    const { byYear, projection } = computeDailyLevels(readings)

    const rows = new Map<number, Record<string, number | boolean>>()
    for (const [year, days] of byYear) {
      for (const [day, p] of days) {
        const row = rows.get(day) ?? { day }
        row[`y${year}`] = Math.round(p.liters)
        if (p.isReading) row[`r${year}`] = true
        rows.set(day, row)
      }
    }
    if (projection) {
      for (const [day, liters] of projection.days) {
        const row = rows.get(day) ?? { day }
        row[`p${projection.year}`] = Math.round(liters)
        rows.set(day, row)
      }
    }

    return {
      years: byYear.map(([year]) => year),
      chartData: [...rows.values()].sort((a, b) => (a.day as number) - (b.day as number)),
      stats: computeYearStats(byYear),
      projectionYear: projection?.year ?? null,
    }
  }, [readings])

  const [activeYears, setActiveYears] = useState<Set<number>>(
    () => new Set(years.slice(-2))
  )

  if (years.length === 0) return null

  const latestYear = years[years.length - 1]

  const toggleYear = (year: number) => {
    setActiveYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const chartConfig = Object.fromEntries(
    years.flatMap((year) => {
      const entry = { label: String(year), color: styleForYear(latestYear, year).color }
      return year === projectionYear
        ? [[`y${year}`, entry], [`p${year}`, entry]]
        : [[`y${year}`, entry]]
    })
  ) satisfies ChartConfig

  const shown = years.filter((year) => activeYears.has(year))
  const showForecast = projectionYear !== null && shown.includes(projectionYear)
  const todayDay = getDayOfYear(new Date())

  return (
    <div className={className}>
      {stats && (
        <div className="space-y-1 pb-4">
          <LeaderRow
            label={`CONSUMED IN ${stats.currentYear}`}
            value={`${Math.round(stats.consumedYtd)} L`}
          />
          {stats.vsPrevPct != null && (
            <LeaderRow
              label={`CONSUMPTION VS ${stats.prevYear} (SAME PERIOD)`}
              value={signed(stats.vsPrevPct, "%")}
            />
          )}
          {stats.levelDiff != null && (
            <LeaderRow
              label={`LEVEL VS ${stats.prevYear} (SAME DAY)`}
              value={signed(stats.levelDiff, " L")}
            />
          )}
        </div>
      )}
      <div className="flex items-center justify-end pb-2">
        <div
          className="flex border-[0.5px] border-foreground"
          role="group"
          aria-label="Years to compare"
        >
          {years.map((year) => (
            <button
              key={year}
              type="button"
              aria-pressed={activeYears.has(year)}
              onClick={() => toggleYear(year)}
              className={cn(
                "px-2 py-1 text-xs leading-[1em] uppercase transition-colors",
                activeYears.has(year)
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-foreground hover:text-background"
              )}
            >
              {year}
            </button>
          ))}
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-48 w-full">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeWidth={0.5} className="stroke-muted" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[1, 366]}
            ticks={MONTH_START_DAYS}
            tickFormatter={(day: number) =>
              MONTH_LABELS[MONTH_START_DAYS.indexOf(day)] ?? ""
            }
            tickLine={false}
            axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
            className="text-muted-foreground"
          />
          <YAxis
            domain={[0, "auto"]}
            tickLine={false}
            axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
            width={38}
            className="text-muted-foreground"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const day = payload[0]?.payload?.day
                  return typeof day === "number" ? dayOfYearLabel(day) : ""
                }}
                formatter={(value, name, item) => {
                  const key = String(name)
                  const year = key.slice(1)
                  const isForecast = key.startsWith("p")
                  // Today carries both series; show it once, as the measured side.
                  if (isForecast && item.payload?.[`y${year}`] != null) return null
                  const suffix = isForecast
                    ? " · FORECAST"
                    : item.payload?.[`r${year}`]
                      ? " · READING"
                      : " · EST."
                  return (
                    <span className="flex items-center gap-1.5 font-mono">
                      <span
                        className="inline-block h-2 w-2"
                        style={{ background: `var(--color-${name})` }}
                      />
                      {year} · {value} L{suffix}
                    </span>
                  )
                }}
              />
            }
          />
          {showForecast && (
            <ReferenceLine
              x={todayDay}
              stroke="var(--ink)"
              strokeWidth={0.5}
              strokeDasharray="1 3"
              label={{
                value: "TODAY",
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
              }}
            />
          )}
          {showForecast && (
            <Line
              dataKey={`p${projectionYear}`}
              type="linear"
              stroke={`var(--color-p${projectionYear})`}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          )}
          {shown.map((year) => {
            const style = styleForYear(latestYear, year)
            return (
              <Line
                key={year}
                dataKey={`y${year}`}
                type="linear"
                connectNulls
                stroke={`var(--color-y${year})`}
                strokeWidth={year === latestYear ? 1.5 : 1}
                strokeDasharray={style.dash}
                dot={readingDot(style.color, year)}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-4 pt-2">
        {shown.map((year) => {
          const style = styleForYear(latestYear, year)
          return (
            <span
              key={year}
              className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground"
            >
              <svg width="16" height="3" aria-hidden="true">
                <line
                  x1="0"
                  y1="1.5"
                  x2="16"
                  y2="1.5"
                  stroke={style.color}
                  strokeWidth={year === latestYear ? 1.5 : 1}
                  strokeDasharray={style.dash}
                />
              </svg>
              {year}
            </span>
          )
        })}
        {showForecast && (
          <span className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
            <svg width="16" height="3" aria-hidden="true">
              <line
                x1="0"
                y1="1.5"
                x2="16"
                y2="1.5"
                stroke={styleForYear(latestYear, projectionYear).color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            </svg>
            Forecast
          </span>
        )}
      </div>
    </div>
  )
}
