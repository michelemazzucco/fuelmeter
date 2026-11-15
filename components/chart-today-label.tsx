type Anchor = "start" | "middle" | "end"

interface TodayLabelProps {
  anchor: Anchor
  viewBox?: { x?: number; y?: number }
}

export function todayAnchor(value: number, min: number, max: number): Anchor {
  const position = (value - min) / (max - min)
  if (position > 0.92) return "end"
  if (position < 0.08) return "start"
  return "middle"
}

/** `label` element for a vertical `ReferenceLine`; Recharts supplies `viewBox`. */
export function TodayLabel({ anchor, viewBox }: TodayLabelProps) {
  if (viewBox?.x == null || viewBox.y == null) return null
  return (
    <text
      x={viewBox.x}
      y={viewBox.y - 5}
      textAnchor={anchor}
      className="small-label"
      fill="var(--muted-foreground)"
    >
      TODAY
    </text>
  )
}
