"use client"

import { memo, useCallback, useMemo } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts"
import {
  format,
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  differenceInCalendarMonths,
} from "date-fns"
import { useYearView } from "@/components/year-view"
import {
  CHART_MARGIN,
  RangeChip,
  SelectionOverlay,
  Y_AXIS_WIDTH,
  useRangeSelection,
  type Range,
} from "@/components/chart-selection"
import type { TimeRange } from "@/lib/forecast-period"
import type { ForecastPoint } from "@/lib/predictions"
import { TodayLabel, todayAnchor } from "@/components/chart-today-label"

interface ConsumptionChartProps {
  forecastPoints: ForecastPoint[]
  thresholdLiters: number
  capacityLiters: number
  className?: string
}

const chartConfig = {
  level: {
    label: "Level (L)",
    color: "var(--chart-1)", // sepia ink
  },
  projected: {
    label: "Forecast (L)",
    color: "var(--chart-2)", // black
  },
} satisfies ChartConfig

/** Small square reading markers, as in the drafting-paper mock. */
function squareDot(props: { cx?: number; cy?: number; index?: number; value?: unknown }) {
  const { cx, cy, index, value } = props
  if (cx == null || cy == null || value == null) return <g key={`dot-${index}`} />
  return (
    <rect
      key={`dot-${index}`}
      x={cx - 1.5}
      y={cy - 1.5}
      width={3}
      height={3}
      fill="var(--foreground)"
    />
  )
}

const DAY_MS = 86_400_000
const KEY_STEP_MS = 7 * DAY_MS
const KEY_START_DAYS = 30

const nearestDayStart = (t: number) => startOfDay(new Date(t + DAY_MS / 2)).getTime()

/** "1 DEC 2026 – 28 FEB 2027", with the first year left out when it is the same. */
export function timeRangeLabel({ from, to }: TimeRange) {
  const sameYear = new Date(from).getFullYear() === new Date(to).getFullYear()
  const a = format(new Date(from), sameYear ? "d MMM" : "d MMM yyyy")
  const b = format(new Date(to), "d MMM yyyy")
  return (from === to ? b : `${a} – ${b}`).toUpperCase()
}

export function ConsumptionChart({ className, ...props }: ConsumptionChartProps) {
  const { forecastSelection, setForecastSelection } = useYearView()
  const { forecastPoints } = props

  const domain = useMemo<Range>(
    () =>
      forecastPoints.length > 0
        ? [forecastPoints[0].date, forecastPoints[forecastPoints.length - 1].date]
        : [0, 1],
    [forecastPoints]
  )

  const plot = useRangeSelection({
    domain,
    value: useMemo(
      () => forecastSelection && [forecastSelection.from, forecastSelection.to],
      [forecastSelection]
    ),
    onChange: useCallback(
      (range) => setForecastSelection(range && { from: range[0], to: range[1] }),
      [setForecastSelection]
    ),
    snap: nearestDayStart,
    keyStep: KEY_STEP_MS,
    keyStart: () => {
      const today = startOfDay(new Date())
      return [today.getTime(), addDays(today, KEY_START_DAYS).getTime()]
    },
  })

  if (forecastPoints.length === 0) {
    return (
      <p className="uppercase text-muted-foreground">No data to display yet.</p>
    )
  }

  return (
    <div>
      <div className="flex pb-2">
        <RangeChip
          label={forecastSelection && timeRangeLabel(forecastSelection)}
          onClear={() => setForecastSelection(null)}
        />
      </div>
      <div
        {...plot}
        aria-label="Tank level and forecast by date. Left and right arrows select and move a period, Shift with an arrow changes its end, Escape clears it."
      >
        <ForecastLines {...props} className={className} />
        {forecastSelection && (
          <SelectionOverlay
            domain={domain}
            range={[forecastSelection.from, forecastSelection.to]}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The Recharts tree. Memoized: the selection changes on every pointer move
 * and none of it is drawn here.
 */
const ForecastLines = memo(function ForecastLines({
  forecastPoints,
  thresholdLiters,
  capacityLiters,
  className,
}: ConsumptionChartProps) {

  const chartData = forecastPoints.map((p) => ({
    date: p.date,
    actual: p.projected ? undefined : p.level,
    projected: p.projected ? p.level : undefined,
    projectedLow: p.projected ? p.levelLow : undefined,
    projectedHigh: p.projected ? p.levelHigh : undefined,
  }))

  const minDate = forecastPoints[0].date
  const maxDate = forecastPoints[forecastPoints.length - 1].date

  // Ticks: aim for ~8 labels across the whole span, on month boundaries.
  const totalMonths = Math.max(1, differenceInCalendarMonths(new Date(maxDate), new Date(minDate)))
  const stepMonths = Math.max(1, Math.ceil(totalMonths / 8))
  const xTicks: number[] = []
  let cursor = startOfMonth(addMonths(new Date(minDate), 1))
  while (cursor.getTime() <= maxDate) {
    xTicks.push(cursor.getTime())
    cursor = addMonths(cursor, stepMonths)
  }

  // Give the last actual point a projected value too so the two lines share
  // that point and there is no gap between the actual and projected series.
  const lastActualIdx = forecastPoints.findLastIndex((p) => !p.projected)
  if (lastActualIdx >= 0 && lastActualIdx < forecastPoints.length - 1) {
    const lastActual = forecastPoints[lastActualIdx]
    chartData[lastActualIdx].projected = lastActual.level
    if (lastActual.levelLow !== undefined) chartData[lastActualIdx].projectedLow = lastActual.level
    if (lastActual.levelHigh !== undefined) chartData[lastActualIdx].projectedHigh = lastActual.level
  }

  const hasBands = forecastPoints.some((p) => p.projected && p.levelLow !== undefined)

  const now = Date.now()
  const showToday = now > minDate && now < maxDate

  const yTicks = Array.from(
    new Set([0, 500, 1000, capacityLiters].filter((v) => v <= capacityLiters))
  ).sort((a, b) => a - b)

  return (
    <ChartContainer config={chartConfig} className={className ?? "h-56 w-full"}>
      <LineChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid strokeWidth={0.5} className="stroke-muted" />
        <XAxis
          dataKey="date"
          type="number"
          scale="time"
          domain={[minDate, maxDate]}
          ticks={xTicks}
          tickFormatter={(v) => format(new Date(v), "MMM yy").toUpperCase()}
          tickLine={false}
          axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
          className="text-muted-foreground"
        />
        <YAxis
          domain={[0, capacityLiters]}
          ticks={yTicks}
          tickLine={false}
          axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
          width={Y_AXIS_WIDTH}
          tickFormatter={(v) => `${v}`}
          className="text-muted-foreground"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                payload[0]?.payload?.date
                  ? format(new Date(payload[0].payload.date as number), "MMM d, yyyy")
                  : ""
              }
            />
          }
        />
        <ReferenceLine
          y={thresholdLiters}
          stroke="var(--foreground)"
          strokeWidth={0.5}
          strokeDasharray="3 3"
          label={{
            value: `LOW · ${thresholdLiters} L`,
            position: "insideBottomLeft",
            fill: "var(--muted-foreground)",
          }}
        />
        {showToday && (
          <ReferenceLine
            x={now}
            stroke="var(--ink)"
            strokeWidth={0.5}
            strokeDasharray="1 3"
            label={<TodayLabel anchor={todayAnchor(now, minDate, maxDate)} />}
          />
        )}
        <Line
          type="monotone"
          dataKey="actual"
          name="Level (L)"
          stroke="var(--color-level)"
          strokeWidth={1}
          dot={squareDot}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          name="Forecast (L)"
          stroke="var(--color-projected)"
          strokeWidth={1}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        {hasBands && <Line
          type="monotone"
          dataKey="projectedHigh"
          name="Optimistic (L)"
          stroke="var(--color-level)"
          strokeWidth={0.5}
          strokeDasharray="2 4"
          strokeOpacity={0.5}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />}
        {hasBands && <Line
          type="monotone"
          dataKey="projectedLow"
          name="Pessimistic (L)"
          stroke="var(--color-level)"
          strokeWidth={0.5}
          strokeDasharray="2 4"
          strokeOpacity={0.5}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />}
      </LineChart>
    </ChartContainer>
  )
})
