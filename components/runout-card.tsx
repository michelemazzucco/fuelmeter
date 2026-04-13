import { format, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"

interface RunoutCardProps {
  runOutDate: Date | null
  daysRemaining: number | null
  dailyRateLiters: number | null
  hasEnoughData: boolean
}

export function RunoutCard({
  runOutDate,
  daysRemaining,
  dailyRateLiters,
  hasEnoughData,
}: RunoutCardProps) {
  if (!hasEnoughData) {
    return (
      <div className="text-sm text-muted-foreground">
        Add at least 2 readings to see a prediction.
      </div>
    )
  }

  const urgent = daysRemaining !== null && daysRemaining <= 14

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "text-3xl font-bold tabular-nums",
          urgent ? "text-destructive" : "text-foreground"
        )}
      >
        {runOutDate ? format(runOutDate, "d MMM yyyy") : "—"}
      </div>
      <div className="text-sm text-muted-foreground space-y-0.5">
        {daysRemaining !== null && (
          <p>
            {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
          </p>
        )}
        {dailyRateLiters !== null && <p>Avg. {dailyRateLiters} L/day consumption</p>}
      </div>
    </div>
  )
}
