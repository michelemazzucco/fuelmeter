import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface FuelGaugeProps {
  levelLiters: number
  capacityLiters: number
  thresholdLiters: number
}

export function FuelGauge({ levelLiters, capacityLiters, thresholdLiters }: FuelGaugeProps) {
  const pct = Math.min(100, Math.max(0, (levelLiters / capacityLiters) * 100))
  const isLow = levelLiters <= thresholdLiters
  const isWarning = !isLow && levelLiters <= thresholdLiters * 2

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <span
          className={cn(
            "text-4xl font-bold tabular-nums",
            isLow ? "text-destructive" : isWarning ? "text-amber-500" : "text-foreground"
          )}
        >
          {levelLiters.toLocaleString()} L
        </span>
        <span className="text-muted-foreground text-sm mb-1">
          of {capacityLiters.toLocaleString()} L ({Math.round(pct)}%)
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          "h-4",
          isLow
            ? "[&>div]:bg-destructive"
            : isWarning
              ? "[&>div]:bg-amber-500"
              : "[&>div]:bg-emerald-500"
        )}
      />
      {isLow && (
        <p className="text-xs text-destructive font-medium">
          Below low-level threshold ({thresholdLiters} L) — consider refilling soon.
        </p>
      )}
    </div>
  )
}
