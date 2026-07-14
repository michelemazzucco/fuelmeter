"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

interface MacWindowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function MacWindow({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: MacWindowProps) {
  const [offset, setOffset] = React.useState({ dx: 0, dy: 0 })
  const dragStart = React.useRef<{
    x: number
    y: number
    dx: number
    dy: number
  } | null>(null)

  React.useEffect(() => {
    if (open) setOffset({ dx: 0, dy: 0 })
  }, [open])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Drag with a mouse only — on touch devices the window stays put.
    if (e.pointerType !== "mouse") return
    dragStart.current = { x: e.clientX, y: e.clientY, dx: offset.dx, dy: offset.dy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start) return
    setOffset({ dx: start.dx + e.clientX - start.x, dy: start.dy + e.clientY - start.y })
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50" />
        <DialogPrimitive.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100dvw-2rem)] sm:w-full sm:max-w-sm",
            "rounded-none border-[0.5px] border-foreground bg-popover p-4 text-foreground",
            "shadow-[1ch_0.5lh_0_0_color-mix(in_srgb,var(--foreground)_12%,var(--background))] outline-none",
            className,
          )}
          style={{
            translate: `calc(-50% + ${offset.dx}px) calc(-50% + ${offset.dy}px)`,
          }}
        >
          {/* Invisible strip over the title edge — the window's drag handle. */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="absolute inset-x-0 top-0 z-10 h-7 cursor-move select-none"
          />
          <div className="relative border-[0.5px] border-foreground px-5 pt-7 pb-5">
            <DialogPrimitive.Title className="absolute -top-[7px] left-1/2 -translate-x-1/2 bg-popover px-2 leading-[1em] font-bold tracking-wide whitespace-nowrap uppercase">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="sr-only">
                {description}
              </DialogPrimitive.Description>
            )}
            {children}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
