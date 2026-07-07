"use client"

import { useMemo, useState } from "react"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid } from "recharts"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { computeConsumptionBuckets, type ConsumptionBucket } from "@/lib/predictions"
import type { Reading } from "@/lib/types"

interface ConsumptionRangeChartProps {
  readings: Reading[]
  className?: string
}

// Long segments make daily bars unreadable — show only the trailing window
const DAILY_WINDOW_DAYS = 60

const chartConfig = {
  measured: {
    label: "Measured",
    color: "var(--foreground)", // solid black — data-backed periods
  },
  estimated: {
    label: "Estimated",
    color: "transparent", // outline only — estimated periods
  },
} satisfies ChartConfig

export function ConsumptionRangeChart({
  readings,
  className,
}: ConsumptionRangeChartProps) {
  const [granularity, setGranularity] = useState<"daily" | "weekly">("weekly")

  const buckets = useMemo(
    () => computeConsumptionBuckets(readings, granularity),
    [readings, granularity]
  )

  if (!buckets || buckets.length === 0) return null

  const visible =
    granularity === "daily" ? buckets.slice(-DAILY_WINDOW_DAYS) : buckets

  const chartData = visible.map((b) => ({
    ...b,
    range: [b.low, b.high] as [number, number],
  }))

  // Aim for ~8 labels on the category axis
  const tickInterval = Math.max(0, Math.ceil(visible.length / 8) - 1)

  return (
    <div className={className}>
      <div className="flex items-center justify-end pb-2">
        <div
          className="flex border-[0.5px] border-foreground"
          role="group"
          aria-label="Bucket granularity"
        >
          {(["daily", "weekly"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={granularity === g}
              onClick={() => setGranularity(g)}
              className={cn(
                "px-2 py-1 text-xs leading-[1em] uppercase transition-colors",
                granularity === g
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-foreground hover:text-background"
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-48 w-full">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="15%"
        >
          <CartesianGrid strokeWidth={0.5} className="stroke-muted" />
          <XAxis
            dataKey="periodStart"
            interval={tickInterval}
            tickFormatter={(v) => format(new Date(v), "d MMM").toUpperCase()}
            tickLine={false}
            axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
            className="text-muted-foreground"
          />
          <YAxis
            tickLine={false}
            axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
            width={38}
            className="text-muted-foreground"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const p = payload[0]?.payload as ConsumptionBucket | undefined
                  if (!p) return ""
                  const label = format(new Date(p.periodStart), "MMM d, yyyy")
                  return granularity === "weekly"
                    ? `WK OF ${label}${p.days < 7 ? ` (${p.days} DAYS)` : ""}`.toUpperCase()
                    : label.toUpperCase()
                }}
                formatter={(_, __, item) => {
                  const p = item.payload as ConsumptionBucket
                  return (
                    <span className="font-mono">
                      {p.low}–{p.high} L (EST. {p.mid} L) ·{" "}
                      {p.measured ? "MEASURED" : "ESTIMATED"}
                    </span>
                  )
                }}
              />
            }
          />
          <Bar
            dataKey="range"
            isAnimationActive={false}
            stroke="var(--foreground)"
            strokeWidth={0.5}
          >
            {chartData.map((b) => (
              <Cell
                key={b.periodStart}
                fill={
                  b.measured ? "var(--color-measured)" : "var(--color-estimated)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex gap-4 pt-2">
        <span className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
          <span className="inline-block h-2 w-2 bg-foreground" />
          Measured
        </span>
        <span className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
          <span className="inline-block h-2 w-2 border-[0.5px] border-foreground" />
          Estimated
        </span>
      </div>
    </div>
  )
}
