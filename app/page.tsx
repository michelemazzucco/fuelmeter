"use client";

import { useEffect, useState } from "react";
import type { Reading, TankConfig } from "@/lib/types";
import { getReadings, getTankConfig } from "@/lib/actions";
import { computePrediction } from "@/lib/predictions";
import { PaperBox, LeaderRow, LoadingLine } from "@/components/paper";
import { READINGS_CHANGED_EVENT } from "@/components/add-record";
import { FuelGauge } from "@/components/fuel-gauge";
import { RunoutCard } from "@/components/runout-card";
import { ConsumptionChart } from "@/components/consumption-chart";
import { YearlyLevelChart } from "@/components/yearly-level-chart";
import { TankIllustration } from "@/components/tank-illustration";
import { format } from "date-fns";

const DEFAULT_CONFIG: TankConfig = {
  id: "",
  capacity_liters: 1000,
  low_threshold_liters: 150,
  updated_at: "",
};

export default function DashboardPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [config, setConfig] = useState<TankConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [readingsData, configData] = await Promise.all([
        getReadings("asc"),
        getTankConfig(),
      ]);
      setReadings(readingsData);
      if (configData) setConfig(configData);
      setLoading(false);
    }
    load();
    // Refresh when the global "Add record" window saves a new reading.
    window.addEventListener(READINGS_CHANGED_EVENT, load);
    return () => window.removeEventListener(READINGS_CHANGED_EVENT, load);
  }, []);

  if (loading) {
    return <LoadingLine />;
  }

  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const prediction = computePrediction(readings, config.capacity_liters);

  const levelPercent =
    latest?.level_liters != null
      ? (latest.level_liters / config.capacity_liters) * 100
      : null;

  // Derive threshold-crossing and ±1σ run-out dates from the forecast.
  const projected = prediction.forecastPoints.filter((p) => p.projected);
  const thresholdPoint = projected.find(
    (p) => p.level <= config.low_threshold_liters,
  );
  const earlyPoint = projected.find(
    (p) => p.levelLow !== undefined && p.levelLow <= 0,
  );
  const latePoint = projected.find(
    (p) => p.levelHigh !== undefined && p.levelHigh <= 0,
  );

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:gap-4">
      <div className="contents lg:block lg:space-y-5 lg:col-span-7">
        <PaperBox label="Estimated run out" className="order-2 lg:order-none">
          <div className="space-y-4">
            <RunoutCard
              runOutDate={prediction.runOutDate}
              daysRemaining={prediction.daysRemaining}
              dailyRateLiters={prediction.dailyRateLiters}
              hasEnoughData={prediction.hasEnoughData}
              thresholdLiters={config.low_threshold_liters}
              thresholdDate={
                thresholdPoint ? new Date(thresholdPoint.date) : null
              }
              runOutEarly={earlyPoint ? new Date(earlyPoint.date) : null}
              runOutLate={latePoint ? new Date(latePoint.date) : null}
            />
            <ConsumptionChart
              forecastPoints={prediction.forecastPoints}
              thresholdLiters={config.low_threshold_liters}
              capacityLiters={config.capacity_liters}
              className="h-64 w-full pt-2"
            />
          </div>
        </PaperBox>

        {readings.some((r) => r.level_liters != null) && (
          <PaperBox label="Year over year" className="order-5 lg:order-none">
            <YearlyLevelChart readings={readings} className="w-full" />
          </PaperBox>
        )}

        <PaperBox label="Consumption stats" className="order-4 lg:order-none">
          {prediction.hasEnoughData ? (
            <div className="space-y-1">
              <LeaderRow
                label="DAILY AVERAGE"
                value={`${prediction.dailyRateLiters ?? "—"} L`}
              />
              <LeaderRow
                label="WEEKLY AVERAGE"
                value={
                  prediction.dailyRateLiters
                    ? `${Math.round(prediction.dailyRateLiters * 7 * 10) / 10} L`
                    : "—"
                }
              />
            </div>
          ) : (
            <p className="uppercase text-muted-foreground">
              Add at least 2 readings to see stats.
            </p>
          )}
        </PaperBox>
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-5 lg:col-span-5">
        <PaperBox label="Current fuel level" className="order-1 lg:order-none">
          {latest ? (
            <div className="space-y-3">
              {latest.level_liters != null ? (
                <FuelGauge
                  levelLiters={latest.level_liters}
                  capacityLiters={config.capacity_liters}
                  thresholdLiters={config.low_threshold_liters}
                />
              ) : (
                <p className="text-muted-foreground">
                  Latest reading: {latest.level_cm} cm — configure the tank
                  profile in Settings to calculate litres.
                </p>
              )}
              <LeaderRow
                label="Last reading"
                value={
                  format(
                    new Date(latest.recorded_at),
                    "d MMM yyyy 'at' HH:mm",
                  ) + (latest.notes ? ` · ${latest.notes}` : "")
                }
              />
            </div>
          ) : (
            <p className="text-muted-foreground">
              No readings yet.{" "}
              <a href="/readings" className="underline underline-offset-2">
                Add your first reading →
              </a>
            </p>
          )}
        </PaperBox>

        {/* Tank illustration */}
        <section className="relative order-3 flex items-center justify-center border-[0.5px] border-foreground px-5 py-9 lg:order-none lg:flex-1">
          {levelPercent != null ? (
            <TankIllustration
              percent={levelPercent}
              className="w-full max-w-[300px]"
            />
          ) : (
            <p className="uppercase text-muted-foreground">No level data</p>
          )}
          <span className="caption-side absolute right-0 bottom-8 translate-x-1/2 rotate-180 [writing-mode:vertical-rl] bg-background py-1 tracking-wide text-muted-foreground">
            FIG. 001 - HEAT OIL TANK
          </span>
        </section>
      </div>
    </div>
  );
}
