"use client"

import { memo, useCallback, useMemo } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts"
import { getDayOfYear } from "date-fns"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LeaderRow } from "@/components/paper"
import { useYearView } from "@/components/year-view"
import {
  CHART_MARGIN,
  RangeChip,
  SelectionOverlay,
  Y_AXIS_WIDTH,
  useRangeSelection,
  type Range,
} from "@/components/chart-selection"
import {
  computeYearStats,
  dayOfYearLabel,
  dayRangeLabel,
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

const DAY_DOMAIN: Range = [1, 366]

const NO_COMPARISON = "none"

// Four rows, the most any view shows, so the chart never moves under the
// pointer when a drag swaps the year rows for the period rows.
const ROWS_MIN_HEIGHT = "calc(4lh + 1.75rem)"
const KEY_STEP_DAYS = 7
const KEY_START_DAYS = 30

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
              ? `${signed(((latest.consumed! - y.consumed!) / y.consumed!) * 100, "%")} (${signed(latest.consumed! - y.consumed!, " L")})`
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
      <LineChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid strokeWidth={0.5} className="stroke-muted" />
        <XAxis
          dataKey="day"
          type="number"
          domain={DAY_DOMAIN}
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
  const { levels, years, activeYears, compareYear, setCompareYear, selection, setSelection, period } =
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

  const plot = useRangeSelection({
    domain: DAY_DOMAIN,
    value: useMemo(() => selection && [selection.fromDay, selection.toDay], [selection]),
    onChange: useCallback(
      (range) => setSelection(range && { fromDay: range[0], toDay: range[1] }),
      [setSelection]
    ),
    snap: Math.round,
    keyStep: KEY_STEP_DAYS,
    keyStart: () => {
      const today = getDayOfYear(new Date())
      return [today - KEY_START_DAYS + 1, today]
    },
  })

  if (years.length === 0) return null

  const latestYear = years[years.length - 1]
  const showForecast = projectionYear !== null && activeYears.includes(projectionYear)

  const compareItems = [
    ...years
      .filter((year) => year !== latestYear)
      .reverse()
      .map((year) => ({ value: String(year), label: `VS ${year}` })),
    { value: NO_COMPARISON, label: "No comparison" },
  ]

  return (
    <div className={className}>
      <div
        aria-live="polite"
        className="space-y-1 pb-4 tabular-nums"
        style={{ minHeight: ROWS_MIN_HEIGHT }}
      >
        {period ? <PeriodRows period={period} /> : stats && <YearRows stats={stats} />}
      </div>
      <div className="flex flex-col items-start gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <RangeChip
          label={selection && dayRangeLabel(selection)}
          onClear={() => setSelection(null)}
        />
        <Select
          items={compareItems}
          value={compareYear === null ? NO_COMPARISON : String(compareYear)}
          onValueChange={(value) =>
            setCompareYear(value === NO_COMPARISON ? null : Number(value))
          }
        >
          <SelectTrigger
            aria-label="Year to compare with"
            className="h-auto! gap-2 border-[0.5px] border-foreground px-2 py-1 leading-[1em] uppercase tabular-nums hover:bg-foreground hover:text-background focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground dark:bg-transparent [&_svg]:size-3! [&_svg]:text-current!"
          >
            <SelectValue>
              {(value: string) =>
                value === NO_COMPARISON ? `${latestYear}` : `${latestYear} VS ${value}`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="end"
            alignItemWithTrigger={false}
            className="min-w-40 border-[0.5px] border-foreground bg-background shadow-none ring-0 before:hidden"
          >
            {compareItems.map((item) => (
              <SelectItem
                key={item.value}
                value={item.value}
                className="py-1.5 uppercase tabular-nums data-highlighted:bg-foreground! data-highlighted:text-background! data-highlighted:**:text-background!"
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        {...plot}
        aria-label="Tank level by day of the year. Left and right arrows select and move a period, Shift with an arrow changes its end, Escape clears it."
      >
        <LevelLines
          chartData={chartData}
          years={years}
          shown={activeYears}
          projectionYear={projectionYear}
        />
        {selection && (
          <SelectionOverlay domain={DAY_DOMAIN} range={[selection.fromDay, selection.toDay]} />
        )}
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
