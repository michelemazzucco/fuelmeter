"use client"

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
import { format, addMonths, startOfMonth, differenceInCalendarMonths } from "date-fns"
import type { ForecastPoint } from "@/lib/predictions"

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

export function ConsumptionChart({
  forecastPoints,
  thresholdLiters,
  capacityLiters,
  className,
}: ConsumptionChartProps) {
  if (forecastPoints.length === 0) {
    return (
      <p className="uppercase text-muted-foreground">No data to display yet.</p>
    )
  }

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
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          width={38}
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
            label={{
              value: "TODAY",
              position: "insideTopLeft",
              fill: "var(--muted-foreground)",
            }}
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
}
