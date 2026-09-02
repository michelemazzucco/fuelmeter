import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { LeaderRow } from "@/components/paper"

interface RunoutCardProps {
  runOutDate: Date | null
  daysRemaining: number | null
  hasEnoughData: boolean
  thresholdLiters: number
  /** Date the level is forecast to cross the low threshold */
  thresholdDate: Date | null
  /** ±1σ run-out window */
  runOutEarly: Date | null
  runOutLate: Date | null
}

export function RunoutCard({
  runOutDate,
  daysRemaining,
  hasEnoughData,
  thresholdLiters,
  thresholdDate,
  runOutEarly,
  runOutLate,
}: RunoutCardProps) {
  if (!hasEnoughData) {
    return (
      <p className="uppercase text-muted-foreground">
        Add at least 2 readings to see a prediction.
      </p>
    )
  }

  const urgent = daysRemaining !== null && daysRemaining <= 14

  return (
    <div className="space-y-1">
      <LeaderRow
        className="tabular-nums"
        label={daysRemaining !== null ? `IN ${daysRemaining} DAYS` : "—"}
        value={
          <span className={cn(urgent && "text-destructive")}>
            {runOutDate ? format(runOutDate, "d MMM yyyy").toUpperCase() : "—"}
          </span>
        }
      />
      {thresholdDate && (
        <LeaderRow
          label={`LOW THRESHOLD (${thresholdLiters} L)`}
          value={format(thresholdDate, "d MMM yyyy").toUpperCase()}
        />
      )}
      {runOutEarly && runOutLate && (
        <LeaderRow
          label="CONFIDENCE ±1σ"
          value={`${format(runOutEarly, "d MMM").toUpperCase()} – ${format(runOutLate, "d MMM").toUpperCase()}`}
        />
      )}
    </div>
  )
}
