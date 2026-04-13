"use client"

import { useEffect, useState } from "react"
import { supabase, type Reading, type TankConfig } from "@/lib/supabase"
import { computePrediction } from "@/lib/predictions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FuelGauge } from "@/components/fuel-gauge"
import { RunoutCard } from "@/components/runout-card"
import { ConsumptionChart } from "@/components/consumption-chart"
import { format } from "date-fns"
import { CalendarClock, Droplets, TrendingDown } from "lucide-react"

const DEFAULT_CONFIG: TankConfig = {
  id: "",
  capacity_liters: 1000,
  low_threshold_liters: 150,
  updated_at: "",
}

export default function DashboardPage() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [config, setConfig] = useState<TankConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: readingsData }, { data: configData }] = await Promise.all([
        supabase.from("readings").select("*").order("recorded_at", { ascending: true }),
        supabase.from("tank_config").select("*").limit(1).single(),
      ])
      setReadings(readingsData ?? [])
      if (configData) setConfig(configData)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  const latest = readings.length > 0 ? readings[readings.length - 1] : null
  const prediction = computePrediction(readings, config.capacity_liters)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Current level */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Droplets className="h-4 w-4 text-blue-500" />
            Current fuel level
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latest ? (
            <>
              {latest.level_liters != null ? (
                <FuelGauge
                  levelLiters={latest.level_liters}
                  capacityLiters={config.capacity_liters}
                  thresholdLiters={config.low_threshold_liters}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Latest reading: {latest.level_cm} cm —{" "}
                  configure the tank profile in Settings to calculate litres.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Last reading: {format(new Date(latest.recorded_at), "d MMM yyyy 'at' HH:mm")}
                {latest.notes ? ` · ${latest.notes}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No readings yet.{" "}
              <a href="/readings" className="underline underline-offset-2">
                Add your first reading →
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Estimated run-out */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <CalendarClock className="h-4 w-4 text-amber-500" />
              Estimated run-out
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RunoutCard
              runOutDate={prediction.runOutDate}
              daysRemaining={prediction.daysRemaining}
              dailyRateLiters={prediction.dailyRateLiters}
              hasEnoughData={prediction.hasEnoughData}
              isSeasonal={prediction.isSeasonal}
            />
          </CardContent>
        </Card>

        {/* Consumption stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <TrendingDown className="h-4 w-4 text-emerald-500" />
              Consumption stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            {prediction.hasEnoughData ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Daily average</span>
                  <span className="font-mono font-medium">{prediction.dailyRateLiters} L/day</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Weekly average</span>
                  <span className="font-mono font-medium">
                    {prediction.dailyRateLiters
                      ? Math.round(prediction.dailyRateLiters * 7 * 10) / 10
                      : "—"}{" "}
                    L/week
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total readings</span>
                  <span className="font-mono font-medium">{readings.length}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add at least 2 readings to see stats.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Level history & forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <ConsumptionChart
            forecastPoints={prediction.forecastPoints}
            thresholdLiters={config.low_threshold_liters}
            capacityLiters={config.capacity_liters}
          />
        </CardContent>
      </Card>
    </div>
  )
}
