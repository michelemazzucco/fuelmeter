import { format, getDaysInMonth } from "date-fns"
import { PaperBox, LeaderRow } from "@/components/paper"
import { BoilerHoursChart } from "@/components/boiler-hours-chart"
import type { BoilerContext } from "@/lib/heating"
import type { Prediction } from "@/lib/predictions"
import type { BoilerPeriod } from "@/lib/types"

const round1 = (v: number) => Math.round(v * 10) / 10
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}%`

const monthOf = (months: BoilerPeriod[], date: Date) =>
  months.find((m) => m.start === format(date, "yyyy-MM-01")) ?? null

export function HeatingBox({
  weeks,
  months,
  boiler,
  prediction,
  lastSyncAt,
  className,
}: {
  weeks: BoilerPeriod[]
  months: BoilerPeriod[]
  boiler: BoilerContext | null
  prediction: Prediction
  lastSyncAt: string | null
  className?: string
}) {
  const today = new Date()
  const monthLabel = format(today, "MMM").toUpperCase()
  const thisPeriod = monthOf(months, today)
  const thisMonth = thisPeriod?.hours ?? null
  // Monthly totals only, so last year's month is prorated to the days this
  // month has data for (anonymous totals stop at the last finished week)
  const lastYearDate = new Date(today.getFullYear() - 1, today.getMonth(), 1)
  const lastYearMonth = monthOf(months, lastYearDate)?.hours ?? null
  const lastYear =
    lastYearMonth != null && thisPeriod
      ? (lastYearMonth * thisPeriod.days) / getDaysInMonth(lastYearDate)
      : null
  const vsLastYear =
    thisMonth != null && lastYear != null && lastYear > 0
      ? ` · ${signedPct(((thisMonth - lastYear) / lastYear) * 100)} VS ${today.getFullYear() - 1}`
      : ""

  return (
    <PaperBox label="Heating" className={className}>
      <div className="space-y-4">
        <div className="space-y-1">
          <LeaderRow
            label={`BOILER HOURS (${monthLabel})`}
            value={thisMonth != null ? `${Math.round(thisMonth)} H${vsLastYear}` : "—"}
          />
          {!boiler && <LeaderRow label="LITRES PER BOILER HOUR" value="NOT ENOUGH DATA YET" />}
          {boiler && (
            <>
              <LeaderRow
                label="LITRES PER BOILER HOUR"
                value={`${Math.round(boiler.model.litersPerHour * 100) / 100} L${boiler.model.fitted ? "" : " (EST.)"}`}
              />
              <LeaderRow
                label="BASE (HOT WATER)"
                value={`${round1(boiler.model.baseLitersPerDay)} L / DAY`}
              />
              {boiler.correction !== 1 && (
                <LeaderRow
                  label="LAST 14 DAYS VS SEASON"
                  value={signedPct((boiler.correction - 1) * 100)}
                />
              )}
            </>
          )}
          {prediction.litersSinceReading != null && prediction.boilerHoursSinceReading != null && (
            <LeaderRow
              label="BURNT SINCE LAST READING"
              value={`${Math.round(prediction.litersSinceReading)} L · ${Math.round(prediction.boilerHoursSinceReading)} H`}
            />
          )}
          {lastSyncAt && (
            <LeaderRow
              label="LAST SYNC"
              value={format(new Date(lastSyncAt), "d MMM HH:mm").toUpperCase()}
            />
          )}
        </div>
        <BoilerHoursChart weeks={weeks} className="h-40 w-full" />
      </div>
    </PaperBox>
  )
}
