import { cn } from "@/lib/utils"

interface FuelGaugeProps {
  levelLiters: number
  capacityLiters: number
  thresholdLiters: number
}

export function FuelGauge({ levelLiters, capacityLiters, thresholdLiters }: FuelGaugeProps) {
  const pct = Math.min(100, Math.max(0, (levelLiters / capacityLiters) * 100))
  const isLow = levelLiters <= thresholdLiters

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className={cn("tabular-nums", isLow && "text-destructive font-bold")}>
          {Math.round(levelLiters).toLocaleString()} L ({Math.round(pct)}%)
        </span>
        <span className="tabular-nums">{capacityLiters.toLocaleString()} L</span>
      </div>
      <div
        className="h-3 w-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fuel level"
      >
        <div
          className={cn("h-full transition-[width]", isLow ? "bg-destructive" : "bg-foreground")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isLow && (
        <p className="text-destructive uppercase">
          Below low threshold ({thresholdLiters} L) — refill soon
        </p>
      )}
    </div>
  )
}
