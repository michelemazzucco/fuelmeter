"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts"
import { getDayOfYear } from "date-fns"
import { cn } from "@/lib/utils"
import { LeaderRow } from "@/components/paper"
import { useYearView } from "@/components/year-view"
import {
  computeYearStats,
  dayOfYearLabel,
  dayRangeLabel,
  type DayRange,
  type PeriodStats,
  type PeriodYear,
  type YearStats,
} from "@/lib/yearly-levels"

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]

// Month-start day-of-year ticks (non-leap reference year)
const MONTH_START_DAYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

const FIRST_DAY = 1
const LAST_DAY = 366

// The plot area inside the chart box, in px. The selection overlay and the
// pointer → day mapping are drawn outside Recharts and must agree with it.
const Y_AXIS_WIDTH = 38
const PLOT_INSET = { top: 8, right: 8, bottom: 30, left: Y_AXIS_WIDTH }

const DRAG_THRESHOLD_PX = 4

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
export const styleForYear = (latestYear: number, year: number) =>
  SERIES_STYLES[Math.max(0, Math.min(latestYear - year, SERIES_STYLES.length - 1))]

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

const signed = (v: number, unit: string) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}${unit}`

const liters = (v: number) => `${Math.round(v)} L`

function YearRows({ stats }: { stats: YearStats }) {
  return (
    <>
      <LeaderRow label="THIS YEAR" value={liters(stats.consumedYtd)} />
      {stats.prevYearTotal != null && (
        <LeaderRow label="LAST YEAR" value={liters(stats.prevYearTotal)} />
      )}
      {stats.vsPrevPct != null && (
        <LeaderRow label="USE, SAME PERIOD" value={signed(stats.vsPrevPct, "%")} />
      )}
      {stats.levelDiff != null && (
        <LeaderRow label="LEVEL, SAME DAY" value={signed(stats.levelDiff, " L")} />
      )}
    </>
  )
}

const coverage = (y: PeriodYear) =>
  y.complete ? String(y.rangeDays) : `${y.coveredDays} OF ${y.rangeDays}`

function SingleYearRows({ label, y }: { label: string; y: PeriodYear }) {
  return (
    <>
      <LeaderRow
        label={`USED, ${label} ${y.year}`}
        value={y.consumed != null ? liters(y.consumed) : "NO DATA"}
      />
      <LeaderRow
        label="DAILY AVERAGE"
        value={y.dailyLiters != null ? `${y.dailyLiters.toFixed(1)} L` : "—"}
      />
      <LeaderRow
        label="LEVEL, START → END"
        value={
          y.startLiters != null && y.endLiters != null
            ? `${Math.round(y.startLiters)} → ${liters(y.endLiters)}`
            : "—"
        }
      />
      <LeaderRow label="DAYS" value={coverage(y)} />
    </>
  )
}

function ComparisonRows({ label, years }: { label: string; years: PeriodYear[] }) {
  const [latest, ...others] = years
  return (
    <>
      {years.map((y, i) => (
        <LeaderRow
          key={y.year}
          label={i === 0 ? `USED, ${label} ${y.year}` : `USED ${y.year}`}
          value={
            y.consumed == null
              ? "NO DATA"
              : y.complete
                ? liters(y.consumed)
                : `${liters(y.consumed)} · ${coverage(y)} DAYS`
          }
        />
      ))}
      {others.map((y) => (
        <LeaderRow
          key={`vs-${y.year}`}
          label={`${latest.year} VS ${y.year}`}
          value={
            latest.complete && y.complete && y.consumed! > 0
              ? signed(((latest.consumed! - y.consumed!) / y.consumed!) * 100, "%")
              : "—"
          }
        />
      ))}
    </>
  )
}

function PeriodRows({ period }: { period: PeriodStats }) {
  const label = dayRangeLabel(period.range)
  return period.years.length === 1 ? (
    <SingleYearRows label={label} y={period.years[0]} />
  ) : (
    <ComparisonRows label={label} years={period.years} />
  )
}

const dayFraction = (day: number) => (day - FIRST_DAY) / (LAST_DAY - FIRST_DAY)

/** `left` of a day inside the chart box, as a CSS length. */
const dayLeft = (day: number) =>
  `calc(${PLOT_INSET.left}px + (100% - ${PLOT_INSET.left + PLOT_INSET.right}px) * ${dayFraction(day)})`

/** Veils over the days outside the range; the lines inside it keep their full ink. */
function SelectionOverlay({ range }: { range: DayRange }) {
  const veil = "pointer-events-none absolute bg-background/70"
  return (
    <>
      <div
        className={veil}
        style={{
          top: PLOT_INSET.top,
          bottom: PLOT_INSET.bottom,
          left: PLOT_INSET.left,
          right: `calc(100% - ${dayLeft(range.fromDay)})`,
        }}
      />
      <div
        className={veil}
        style={{
          top: PLOT_INSET.top,
          bottom: PLOT_INSET.bottom,
          left: dayLeft(range.toDay),
          right: PLOT_INSET.right,
        }}
      />
      <div
        className="pointer-events-none absolute border-x-[0.5px] border-foreground"
        style={{
          top: PLOT_INSET.top,
          bottom: PLOT_INSET.bottom,
          left: dayLeft(range.fromDay),
          right: `calc(100% - ${dayLeft(range.toDay)})`,
        }}
      />
    </>
  )
}

type ChartRow = Record<string, number | boolean>

/**
 * The Recharts tree. Memoized: the selection changes on every pointer move
 * and none of it is drawn here.
 */
const LevelLines = memo(function LevelLines({
  chartData,
  years,
  shown,
  projectionYear,
}: {
  chartData: ChartRow[]
  years: number[]
  shown: number[]
  projectionYear: number | null
}) {
  const latestYear = years[years.length - 1]

  const chartConfig = Object.fromEntries(
    years.flatMap((year) => {
      const entry = { label: String(year), color: styleForYear(latestYear, year).color }
      return year === projectionYear
        ? [[`y${year}`, entry], [`p${year}`, entry]]
        : [[`y${year}`, entry]]
    })
  ) satisfies ChartConfig

  const showForecast = projectionYear !== null && shown.includes(projectionYear)
  const todayDay = getDayOfYear(new Date())

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <LineChart data={chartData} margin={{ top: PLOT_INSET.top, right: PLOT_INSET.right, bottom: 0, left: 0 }}>
        <CartesianGrid strokeWidth={0.5} className="stroke-muted" />
        <XAxis
          dataKey="day"
          type="number"
          domain={[FIRST_DAY, LAST_DAY]}
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
          width={Y_AXIS_WIDTH}
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
  )
})

export function YearlyLevelChart({ className }: { className?: string }) {
  const { levels, years, activeYears, toggleYear, selection, setSelection, period } =
    useYearView()

  const { chartData, stats, projectionYear } = useMemo(() => {
    const { byYear, projection } = levels

    const rows = new Map<number, ChartRow>()
    for (const [year, days] of byYear) {
      for (const [day, p] of days) {
        const row = rows.get(day) ?? { day }
        row[`y${year}`] = Math.round(p.liters)
        if (p.isReading) row[`r${year}`] = true
        rows.set(day, row)
      }
    }
    if (projection) {
      for (const [day, level] of projection.days) {
        const row = rows.get(day) ?? { day }
        row[`p${projection.year}`] = Math.round(level)
        rows.set(day, row)
      }
    }

    return {
      chartData: [...rows.values()].sort((a, b) => (a.day as number) - (b.day as number)),
      stats: computeYearStats(byYear),
      projectionYear: projection?.year ?? null,
    }
  }, [levels])

  const plotRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startDay: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!selection) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selection, setSelection])

  if (years.length === 0) return null

  const latestYear = years[years.length - 1]
  const showForecast = projectionYear !== null && activeYears.includes(projectionYear)

  const dayAt = (clientX: number) => {
    const rect = plotRef.current!.getBoundingClientRect()
    const plotWidth = rect.width - PLOT_INSET.left - PLOT_INSET.right
    const t = (clientX - rect.left - PLOT_INSET.left) / plotWidth
    return Math.round(FIRST_DAY + Math.min(1, Math.max(0, t)) * (LAST_DAY - FIRST_DAY))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A second finger must not restart the drag from its own position.
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startDay: dayAt(e.clientX),
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    const day = dayAt(e.clientX)
    setSelection({ fromDay: Math.min(d.startDay, day), toDay: Math.max(d.startDay, day) })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    // A tap is how a touch user opens the tooltip, so only a mouse click clears.
    if (!d.moved && e.type === "pointerup" && e.pointerType === "mouse") setSelection(null)
  }

  const KEY_STEP_DAYS = 7
  const KEY_START_DAYS = 30

  /** Arrows move the period by a week, Shift+arrows move its end. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    if (!selection) {
      const today = getDayOfYear(new Date())
      setSelection({ fromDay: Math.max(FIRST_DAY, today - KEY_START_DAYS + 1), toDay: today })
      return
    }
    const step = e.key === "ArrowLeft" ? -KEY_STEP_DAYS : KEY_STEP_DAYS
    const { fromDay, toDay } = selection
    if (e.shiftKey) {
      setSelection({ fromDay, toDay: Math.min(LAST_DAY, Math.max(fromDay, toDay + step)) })
      return
    }
    const shift = Math.min(LAST_DAY - toDay, Math.max(FIRST_DAY - fromDay, step))
    setSelection({ fromDay: fromDay + shift, toDay: toDay + shift })
  }

  // Constant for a given set of years, so the chart never moves under the
  // pointer when a drag swaps the year rows for the period rows.
  const rowSlots = Math.max(4, activeYears.length * 2 - 1)

  return (
    <div className={className}>
      <div
        aria-live="polite"
        className="space-y-1 pb-4 tabular-nums"
        style={{ minHeight: `calc(${rowSlots}lh + ${(rowSlots - 1) * 0.25 + 1}rem)` }}
      >
        {period ? <PeriodRows period={period} /> : stats && <YearRows stats={stats} />}
      </div>
      <div className="flex flex-col items-start gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
        {selection ? (
          <button
            type="button"
            onClick={() => setSelection(null)}
            aria-label={`Clear the selected period, ${dayRangeLabel(selection)}`}
            className="relative flex items-center gap-1.5 border-[0.5px] border-foreground px-2 py-1 text-xs leading-[1em] whitespace-nowrap uppercase tabular-nums transition-colors after:absolute after:-inset-3 hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            {dayRangeLabel(selection)}
            <span aria-hidden>×</span>
          </button>
        ) : (
          <span className="border-[0.5px] border-transparent py-1 text-xs leading-[1em] whitespace-nowrap uppercase text-muted-foreground">
            Drag on the chart to select a period
          </span>
        )}
        <div
          className="flex border-[0.5px] border-foreground"
          role="group"
          aria-label="Years to compare"
        >
          {years.map((year) => (
            <button
              key={year}
              type="button"
              aria-pressed={activeYears.includes(year)}
              onClick={() => toggleYear(year)}
              className={cn(
                "px-2 py-1 text-xs leading-[1em] uppercase transition-colors",
                activeYears.includes(year)
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-foreground hover:text-background"
              )}
            >
              {year}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={plotRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="group"
        aria-label="Tank level by day of the year. Left and right arrows select and move a period, Shift with an arrow changes its end, Escape clears it."
        className={cn(
          "relative isolate touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [@media(pointer:fine)]:cursor-crosshair [&_.recharts-tooltip-wrapper]:z-10",
          dragging && "[&_.recharts-tooltip-cursor]:opacity-0 [&_.recharts-tooltip-wrapper]:opacity-0"
        )}
      >
        <LevelLines
          chartData={chartData}
          years={years}
          shown={activeYears}
          projectionYear={projectionYear}
        />
        {selection && <SelectionOverlay range={selection} />}
      </div>
      <div className="flex flex-wrap gap-4 pt-2">
        {activeYears.map((year) => {
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
