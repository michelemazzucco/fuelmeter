"use client"

import { useMemo, useState } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts"
import { addDays, differenceInDays, format, getDayOfYear, startOfDay } from "date-fns"
import { cn } from "@/lib/utils"
import { LeaderRow } from "@/components/paper"
import { computeMonthlyWeights } from "@/lib/predictions"
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
 * Daily tank level estimated between consecutive readings, sliced per
 * calendar year. `y<year>` holds the litres for that day-of-year; `r<year>`
 * marks days with an actual reading.
 *
 * Falling intervals distribute the measured drop across days proportionally
 * to the seasonal monthly weights (autumn days burn less of a long gap than
 * winter days), falling back to linear when there isn't enough seasonal
 * history. Rising intervals (refill windows) stay linear — the pre-fill
 * level is unknown.
 */
function computeDailyLevels(readings: Reading[]) {
  const sorted = readings
    .filter((r) => r.level_liters != null)
    .map((r) => ({ date: startOfDay(new Date(r.recorded_at)), liters: r.level_liters! }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const weights = computeMonthlyWeights(readings)

  // year → dayOfYear → point; reading days win over interpolated boundaries
  const byYear = new Map<number, Map<number, { liters: number; isReading: boolean }>>()
  const setPoint = (date: Date, liters: number, isReading: boolean) => {
    const year = date.getFullYear()
    const days = byYear.get(year) ?? new Map()
    const day = getDayOfYear(date)
    const existing = days.get(day)
    if (!existing || isReading) {
      days.set(day, { liters, isReading: isReading || existing?.isReading || false })
    }
    byYear.set(year, days)
  }

  if (sorted.length === 1) {
    setPoint(sorted[0].date, sorted[0].liters, true)
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const span = differenceInDays(b.date, a.date)
    if (span <= 0) continue

    if (weights && b.liters < a.liters) {
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

  return [...byYear.entries()].sort(([a], [b]) => a - b)
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
  const { years, chartData, stats } = useMemo(() => {
    const byYear = computeDailyLevels(readings)

    const rows = new Map<number, Record<string, number | boolean>>()
    for (const [year, days] of byYear) {
      for (const [day, p] of days) {
        const row = rows.get(day) ?? { day }
        row[`y${year}`] = Math.round(p.liters)
        if (p.isReading) row[`r${year}`] = true
        rows.set(day, row)
      }
    }

    return {
      years: byYear.map(([year]) => year),
      chartData: [...rows.values()].sort((a, b) => (a.day as number) - (b.day as number)),
      stats: computeYearStats(byYear),
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
    years.map((year) => [
      `y${year}`,
      { label: String(year), color: styleForYear(latestYear, year).color },
    ])
  ) satisfies ChartConfig

  const shown = years.filter((year) => activeYears.has(year))

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
                  const isReading = item.payload?.[`r${String(name).slice(1)}`]
                  return (
                    <span className="flex items-center gap-1.5 font-mono">
                      <span
                        className="inline-block h-2 w-2"
                        style={{ background: `var(--color-${name})` }}
                      />
                      {String(name).slice(1)} · {value} L
                      {isReading ? " · READING" : " · EST."}
                    </span>
                  )
                }}
              />
            }
          />
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
      </div>
    </div>
  )
}
