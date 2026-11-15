"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoilerHours, Reading, TankConfig } from "@/lib/types";
import {
  getBoilerHours,
  getReadings,
  getTankConfig,
  syncBoilerHours,
} from "@/lib/actions";
import { computeConsumptionStats, computePrediction } from "@/lib/predictions";
import {
  boilerDaysOf,
  boilerPeriodsOf,
  buildBoilerContext,
} from "@/lib/heating";
import { HeatingBox } from "@/components/heating-box";
import { PaperBox, LeaderRow, LoadingLine } from "@/components/paper";
import { READINGS_CHANGED_EVENT } from "@/components/add-record";
import { FuelGauge } from "@/components/fuel-gauge";
import { RunoutCard } from "@/components/runout-card";
import {
  ConsumptionChart,
  timeRangeLabel,
} from "@/components/consumption-chart";
import { YearlyLevelChart } from "@/components/yearly-level-chart";
import {
  TankIllustration,
  type TankPeriod,
} from "@/components/tank-illustration";
import { YearViewProvider, useYearView } from "@/components/year-view";
import { computeDailyLevels, dayRangeLabel } from "@/lib/yearly-levels";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const DEFAULT_CONFIG: TankConfig = {
  id: "",
  capacity_liters: 1000,
  low_threshold_liters: 150,
  updated_at: "",
};

export default function DashboardPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [config, setConfig] = useState<TankConfig>(DEFAULT_CONFIG);
  const [boilerHours, setBoilerHours] = useState<BoilerHours>({
    resolution: "day",
    days: [],
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [readingsData, configData, boilerData] = await Promise.all([
        getReadings("asc"),
        getTankConfig(),
        getBoilerHours(),
      ]);
      setReadings(readingsData);
      if (configData) setConfig(configData);
      setBoilerHours(boilerData);
      setLoading(false);
    }
    // Render from stored boiler hours first; the Netatmo sync can take a while
    async function sync() {
      const result = await syncBoilerHours();
      setLastSyncAt(result.lastSyncAt);
      if (result.status === "error") console.warn("Netatmo sync:", result.error);
      if (result.added > 0) setBoilerHours(await getBoilerHours());
    }
    load().then(sync);
    // Refresh when the global "Add record" window saves a new reading.
    window.addEventListener(READINGS_CHANGED_EVENT, load);
    return () => window.removeEventListener(READINGS_CHANGED_EVENT, load);
  }, []);

  const boilerDays = useMemo(() => boilerDaysOf(boilerHours), [boilerHours]);
  const boilerPeriods = useMemo(
    () => boilerPeriodsOf(boilerHours),
    [boilerHours],
  );
  const boiler = useMemo(
    () => buildBoilerContext(readings, boilerDays),
    [readings, boilerDays],
  );

  const yearlyLevels = useMemo(
    () => computeDailyLevels(readings, boiler ?? undefined),
    [readings, boiler],
  );

  if (loading) {
    return <LoadingLine />;
  }

  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const prediction = computePrediction(
    readings,
    config.capacity_liters,
    boiler ?? undefined,
  );
  const annual = computeConsumptionStats(readings, boiler ?? undefined);

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
    <YearViewProvider
      levels={yearlyLevels}
      forecastPoints={prediction.forecastPoints}
    >
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-12 lg:gap-4">
      <div className="contents lg:block lg:space-y-5 lg:col-span-7">
        <PaperBox label="Estimated run out" className="order-2 lg:order-none">
          <div className="space-y-4">
            <RunoutRows>
              <RunoutCard
                runOutDate={prediction.runOutDate}
                daysRemaining={prediction.daysRemaining}
                hasEnoughData={prediction.hasEnoughData}
                thresholdLiters={config.low_threshold_liters}
                thresholdDate={
                  thresholdPoint ? new Date(thresholdPoint.date) : null
                }
                runOutEarly={earlyPoint ? new Date(earlyPoint.date) : null}
                runOutLate={latePoint ? new Date(latePoint.date) : null}
                fromHistory={prediction.fromHistory}
                sinceRefill={annual?.sinceRefill ?? null}
              />
            </RunoutRows>
            <ConsumptionChart
              forecastPoints={prediction.forecastPoints}
              thresholdLiters={config.low_threshold_liters}
              capacityLiters={config.capacity_liters}
              className="h-64 w-full"
            />
          </div>
        </PaperBox>

        {readings.some((r) => r.level_liters != null) && (
          <PaperBox label="Year over year" className="order-5 lg:order-none">
            <YearlyLevelChart className="w-full" />
          </PaperBox>
        )}

        <PaperBox
          label={
            annual && annual.coveredDays < 365
              ? `Consumption stats (last ${annual.coveredDays} days)`
              : "Consumption stats (last 12 months)"
          }
          className="order-4 lg:order-none"
        >
          {annual ? (
            <div className="space-y-1">
              <LeaderRow
                label="DAILY AVERAGE"
                value={`${Math.round(annual.dailyLiters * 10) / 10} L`}
              />
              {annual.minDailyLiters != null && annual.maxDailyLiters != null && (
                <LeaderRow
                  label="DAILY MIN / MAX"
                  value={`${Math.round(annual.minDailyLiters * 10) / 10} – ${Math.round(annual.maxDailyLiters * 10) / 10} L`}
                />
              )}
              <LeaderRow
                label="WEEKLY AVERAGE"
                value={`${Math.round(annual.dailyLiters * 7 * 10) / 10} L`}
              />
              <LeaderRow
                label="DAILY AVERAGE, LAST 30 DAYS"
                value={`${Math.round(annual.last30DailyLiters * 10) / 10} L`}
              />
            </div>
          ) : (
            <p className="uppercase text-muted-foreground">
              Add more readings to see a 12-month average.
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
              {prediction.estimatedLevelToday != null &&
                prediction.litersSinceReading != null && (
                  <LeaderRow
                    label="ESTIMATED TODAY"
                    value={`~${Math.round(prediction.estimatedLevelToday)} L (−${Math.round(prediction.litersSinceReading)} L SINCE READING)`}
                  />
                )}
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

        <TankFigure
          levelPercent={levelPercent}
          todayLiters={prediction.estimatedLevelToday}
          capacityLiters={config.capacity_liters}
        />

        {boilerDays.length > 0 && (
          <HeatingBox
            weeks={boilerPeriods.weeks}
            months={boilerPeriods.months}
            boiler={boiler}
            prediction={prediction}
            lastSyncAt={lastSyncAt}
            className="order-3 lg:order-none"
          />
        )}
      </div>
    </div>
    </YearViewProvider>
  );
}

const oneDecimal = (v: number) => `${Math.round(v * 10) / 10} L`;

/**
 * The run-out rows, replaced by the selected period of the run-out chart.
 * The two sets share one grid cell, so the box keeps the height of the taller
 * set and the chart does not move under the pointer when a drag swaps them.
 */
function RunoutRows({ children }: { children: React.ReactNode }) {
  const { forecastPeriod: period } = useYearView();
  const cell = "col-start-1 row-start-1";

  return (
    <div
      className="grid"
      aria-live="polite"
      style={{ minHeight: "calc(4lh + 0.75rem)" }}
    >
      <div className={cn(cell, period && "invisible")} aria-hidden={!!period}>
        {children}
      </div>
      {period && (
        <div className={cn(cell, "space-y-1 tabular-nums")}>
          <LeaderRow
            label={`${period.estimated ? "ESTIMATED USE" : "USED"}, ${timeRangeLabel(period.range)}`}
            value={`${Math.round(period.consumed)} L`}
          />
          <LeaderRow
            label="DAILY AVERAGE"
            value={
              period.dailyLiters != null ? oneDecimal(period.dailyLiters) : "—"
            }
          />
          <LeaderRow
            label="LEVEL, START → END"
            value={`${Math.round(period.startLiters)} → ${Math.round(period.endLiters)} L`}
          />
          <LeaderRow label="DAYS" value={period.days} />
        </div>
      )}
    </div>
  );
}

// Two years rarely differ by more than 1–2 % of the tank over the same
// period, a hairline at the scale of the drawing. Below this height the
// lighter band is a sign that the years differ, not a measure of it: the
// litres are in the comparison row.
const MIN_EXTRA_BAND_PERCENT = 4;

const extraBandPercent = (gapPercent: number) =>
  gapPercent < 0.05 ? 0 : Math.max(gapPercent, MIN_EXTRA_BAND_PERCENT);

/**
 * The tank drawing. A period of the year-over-year chart shows the latest
 * year: the level at the end of the period with the use hatched above it. A
 * period of the run-out chart shows today's level, with the use hatched where
 * it is in the tank.
 */
function TankFigure({
  levelPercent,
  todayLiters,
  capacityLiters,
}: {
  levelPercent: number | null;
  todayLiters: number | null;
  capacityLiters: number;
}) {
  const { period, forecastPeriod } = useYearView();
  const percentOf = (liters: number) => (liters / capacityLiters) * 100;

  let tankPeriod: TankPeriod | null = null;
  const [latest, other] = period?.years ?? [];
  if (period && latest?.endLiters != null) {
    const end = latest.endLiters;
    const used = latest.consumed!;
    // With a compared year over the same full range, the hatch is the use the
    // two years share and the lighter band is what one of them used on top.
    const comparable =
      latest.complete && other?.complete ? other.consumed! : null;
    tankPeriod = {
      label: `${dayRangeLabel(period.range)} ${latest.year}`,
      levelPercent: percentOf(end),
      bandBottomPercent: percentOf(end),
      bandTopPercent: percentOf(end + Math.min(used, comparable ?? used)),
      extraTopPercent:
        percentOf(end + Math.min(used, comparable ?? used)) +
        extraBandPercent(percentOf(Math.abs(used - (comparable ?? used)))),
    };
  } else if (forecastPeriod && levelPercent != null) {
    tankPeriod = {
      label: timeRangeLabel(forecastPeriod.range),
      levelPercent:
        todayLiters != null ? percentOf(todayLiters) : levelPercent,
      bandTopPercent: percentOf(
        forecastPeriod.endLiters + forecastPeriod.consumed,
      ),
      bandBottomPercent: percentOf(forecastPeriod.endLiters),
    };
  }

  return (
    <section className="relative order-3 flex items-center justify-center border-[0.5px] border-foreground px-5 py-9 lg:order-none lg:flex-1">
      {levelPercent != null ? (
        <TankIllustration
          percent={levelPercent}
          period={tankPeriod}
          className="w-full max-w-[300px]"
        />
      ) : (
        <p className="uppercase text-muted-foreground">No level data</p>
      )}
      <span className="caption-side absolute right-0 bottom-8 translate-x-1/2 rotate-180 [writing-mode:vertical-rl] bg-background py-1 tracking-wide text-muted-foreground tabular-nums">
        FIG. 001 - {tankPeriod ? tankPeriod.label : "HEAT OIL TANK"}
      </span>
    </section>
  );
}
