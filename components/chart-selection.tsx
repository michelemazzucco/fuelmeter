"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Drag selection of an x range on a Recharts line chart, drawn outside
 * Recharts so a drag never re-renders the lines.
 *
 * The plot area inside the chart box, in px: the overlay and the pointer →
 * value mapping must agree with the chart's Y-axis width, margins and X-axis
 * height.
 */
export const Y_AXIS_WIDTH = 38
export const PLOT_INSET = { top: 8, right: 8, bottom: 30, left: Y_AXIS_WIDTH }
export const CHART_MARGIN = { top: PLOT_INSET.top, right: PLOT_INSET.right, bottom: 0, left: 0 }

const DRAG_THRESHOLD_PX = 4

export type Range = [from: number, to: number]

type RangeSelectionOptions = {
  /** The x domain of the chart. */
  domain: Range
  value: Range | null
  onChange: (range: Range | null) => void
  /** Rounds a pointer position to a value the chart can show. */
  snap: (value: number) => number
  /** How far one arrow key moves the range. */
  keyStep: number
  /** The range the first arrow key selects. */
  keyStart: () => Range
}

export function useRangeSelection({
  domain: [min, max],
  value,
  onChange,
  snap,
  keyStep,
  keyStart,
}: RangeSelectionOptions) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; start: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const hasValue = value !== null
  useEffect(() => {
    if (!hasValue) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChange(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hasValue, onChange])

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const valueAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const plotWidth = rect.width - PLOT_INSET.left - PLOT_INSET.right
    const t = (clientX - rect.left - PLOT_INSET.left) / plotWidth
    return clamp(snap(min + Math.min(1, Math.max(0, t)) * (max - min)))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A second finger must not restart the drag from its own position.
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      start: valueAt(e.clientX),
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    const v = valueAt(e.clientX)
    onChange([Math.min(d.start, v), Math.max(d.start, v)])
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    // A tap is how a touch user opens the tooltip, so only a mouse click clears.
    if (!d.moved && e.type === "pointerup" && e.pointerType === "mouse") onChange(null)
  }

  /** Arrows move the range by one step, Shift+arrows move its end. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    if (!value) {
      const [from, to] = keyStart()
      onChange([clamp(from), clamp(to)])
      return
    }
    const step = e.key === "ArrowLeft" ? -keyStep : keyStep
    const [from, to] = value
    if (e.shiftKey) {
      onChange([from, Math.min(max, Math.max(from, to + step))])
      return
    }
    const shift = Math.min(max - to, Math.max(min - from, step))
    onChange([from + shift, to + shift])
  }

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown,
    tabIndex: 0,
    role: "group",
    className: cn(
      "relative isolate touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [@media(pointer:fine)]:cursor-crosshair [&_.recharts-tooltip-wrapper]:z-10",
      dragging && "[&_.recharts-tooltip-cursor]:opacity-0 [&_.recharts-tooltip-wrapper]:opacity-0"
    ),
  }
}

/** Veils over the values outside the range; the lines inside it keep their full ink. */
export function SelectionOverlay({ domain: [min, max], range: [from, to] }: { domain: Range; range: Range }) {
  /** `left` of a value inside the chart box, as a CSS length. */
  const leftOf = (value: number) =>
    `calc(${PLOT_INSET.left}px + (100% - ${PLOT_INSET.left + PLOT_INSET.right}px) * ${(value - min) / (max - min)})`
  const rightOf = (value: number) => `calc(100% - ${leftOf(value)})`
  const vertical = { top: PLOT_INSET.top, bottom: PLOT_INSET.bottom }
  const veil = "pointer-events-none absolute bg-background/70"
  return (
    <>
      <div className={veil} style={{ ...vertical, left: PLOT_INSET.left, right: rightOf(from) }} />
      <div className={veil} style={{ ...vertical, left: leftOf(to), right: PLOT_INSET.right }} />
      <div
        className="pointer-events-none absolute border-x-[0.5px] border-foreground"
        style={{ ...vertical, left: leftOf(from), right: rightOf(to) }}
      />
    </>
  )
}

/** The selected range as a button that clears it, or a hint of the same height. */
export function RangeChip({ label, onClear }: { label: string | null; onClear: () => void }) {
  const box = "border-[0.5px] py-1 text-xs leading-[1em] whitespace-nowrap uppercase"
  if (!label) {
    return (
      <span className={cn(box, "border-transparent text-muted-foreground")}>
        Drag on the chart to select a period
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear the selected period, ${label}`}
      className={cn(
        box,
        "relative flex items-center gap-1.5 border-foreground px-2 tabular-nums transition-colors after:absolute after:-inset-3 hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      )}
    >
      {label}
      <span aria-hidden>×</span>
    </button>
  )
}
