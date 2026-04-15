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
import { format, addMonths, startOfMonth } from "date-fns"
import type { ForecastPoint } from "@/lib/predictions"

interface ConsumptionChartProps {
  forecastPoints: ForecastPoint[]
  thresholdLiters: number
  capacityLiters: number
}

const chartConfig = {
  level: {
    label: "Level (L)",
    color: "var(--chart-1)",
  },
  projected: {
    label: "Projected (L)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export function ConsumptionChart({
  forecastPoints,
  thresholdLiters,
  capacityLiters,
}: ConsumptionChartProps) {
  if (forecastPoints.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No data to display yet.</p>
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

  // One tick per month
  const xTicks: number[] = []
  let cursor = startOfMonth(addMonths(new Date(minDate), 1))
  while (cursor.getTime() <= maxDate) {
    xTicks.push(cursor.getTime())
    cursor = addMonths(cursor, 1)
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

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          type="number"
          scale="time"
          domain={[minDate, maxDate]}
          ticks={xTicks}
          tickFormatter={(v) => format(new Date(v), "MMM")}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          className="text-muted-foreground"
        />
        <YAxis
          domain={[0, capacityLiters]}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={42}
          tickFormatter={(v) => `${v}L`}
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
          stroke="hsl(var(--destructive))"
          strokeDasharray="4 4"
          label={{ value: "Low", position: "insideTopRight", fontSize: 10 }}
        />
        <Line
          type="monotone"
          dataKey="actual"
          name="Level (L)"
          stroke="var(--color-level)"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          name="Projected (L)"
          stroke="var(--color-projected)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
        />
        {hasBands && <Line
          type="monotone"
          dataKey="projectedHigh"
          name="Optimistic (L)"
          stroke="var(--color-projected)"
          strokeWidth={1}
          strokeDasharray="2 4"
          strokeOpacity={0.5}
          dot={false}
          connectNulls={false}
        />}
        {hasBands && <Line
          type="monotone"
          dataKey="projectedLow"
          name="Pessimistic (L)"
          stroke="var(--color-projected)"
          strokeWidth={1}
          strokeDasharray="2 4"
          strokeOpacity={0.5}
          dot={false}
          connectNulls={false}
        />}
      </LineChart>
    </ChartContainer>
  )
}
