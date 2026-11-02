"use client"

import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts"
import { addWeeks, format, startOfWeek } from "date-fns"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { BoilerPeriod } from "@/lib/types"

const WEEKS = 52

const chartConfig = {
  hours: {
    label: "Boiler hours",
    color: "var(--foreground)",
  },
} satisfies ChartConfig

/** Boiler-on hours per week for the last 52 weeks, current week included. */
export function BoilerHoursChart({
  weeks: boilerWeeks,
  className,
}: {
  weeks: BoilerPeriod[]
  className?: string
}) {
  const data = useMemo(() => {
    const firstWeek = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), -(WEEKS - 1))
    const hoursByWeek = new Map(boilerWeeks.map((w) => [w.start, w.hours]))
    return Array.from({ length: WEEKS }, (_, i) => {
      const week = addWeeks(firstWeek, i)
      const hours = hoursByWeek.get(format(week, "yyyy-MM-dd")) ?? 0
      return { week: week.getTime(), hours: Math.round(hours * 10) / 10 }
    })
  }, [boilerWeeks])

  const monthTicks = data
    .filter((w, i) => i > 0 && new Date(w.week).getMonth() !== new Date(data[i - 1].week).getMonth())
    .map((w) => w.week)
    .filter((_, i) => i % 2 === 0)

  return (
    <ChartContainer config={chartConfig} className={className ?? "h-40 w-full"}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} strokeWidth={0.5} className="stroke-muted" />
        <XAxis
          dataKey="week"
          ticks={monthTicks}
          tickFormatter={(v) => format(new Date(v), "MMM").toUpperCase()}
          tickLine={false}
          axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
          interval={0}
          className="text-muted-foreground"
        />
        <YAxis
          tickLine={false}
          axisLine={{ stroke: "var(--ink)", strokeWidth: 0.5 }}
          width={38}
          allowDecimals={false}
          className="text-muted-foreground"
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                payload[0]?.payload?.week
                  ? `WEEK OF ${format(new Date(payload[0].payload.week as number), "d MMM yyyy").toUpperCase()}`
                  : ""
              }
            />
          }
        />
        <Bar dataKey="hours" fill="var(--color-hours)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}
