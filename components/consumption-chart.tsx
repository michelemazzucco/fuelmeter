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
  ResponsiveContainer,
} from "recharts"
import type { ForecastPoint } from "@/lib/predictions"

interface ConsumptionChartProps {
  forecastPoints: ForecastPoint[]
  thresholdLiters: number
  capacityLiters: number
}

const chartConfig = {
  level: {
    label: "Level (L)",
    color: "hsl(var(--chart-1))",
  },
  projected: {
    label: "Projected (L)",
    color: "hsl(var(--chart-2))",
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

  // Split into actual and projected series so we can style them differently
  const chartData = forecastPoints.map((p) => ({
    date: p.date,
    actual: p.projected ? undefined : p.level,
    projected: p.projected ? p.level : undefined,
    // For the connecting dot between actual and projected, duplicate the last actual point
  }))

  // Patch: carry the last actual value as the first projected point for a continuous line
  const lastActualIdx = forecastPoints.findLastIndex((p) => !p.projected)
  if (lastActualIdx >= 0 && lastActualIdx < forecastPoints.length - 1) {
    chartData[lastActualIdx + 1].projected = forecastPoints[lastActualIdx].level
  }

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
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
        <ChartTooltip content={<ChartTooltipContent />} />
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
      </LineChart>
    </ChartContainer>
  )
}
