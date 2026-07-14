import { cn } from "@/lib/utils"

/**
 * Fieldset-style container from the drafting-paper design: hairline black
 * border with an ALL-CAPS label breaking the top border.
 */
export function PaperBox({
  label,
  className,
  contentClassName,
  children,
}: {
  label: string
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("relative border-[0.5px] border-foreground", className)}>
      <h2 className="absolute -top-2.5 left-2 bg-background px-1 uppercase">
        {label}
      </h2>
      <div className={cn("px-4 pb-4 pt-5", contentClassName)}>{children}</div>
    </section>
  )
}

/**
 * Page-level loading state: animated braille spinner (CSS-only, see
 * `.braille-spinner` in globals.css) followed by an ALL-CAPS label.
 */
export function LoadingLine({ label = "Loading" }: { label?: string }) {
  return (
    <p className="uppercase text-muted-foreground">
      <span aria-hidden className="braille-spinner mr-2" />
      {label}
    </p>
  )
}

/**
 * Label ……………… value row with a dashed leader line, as used across the
 * dashboard boxes.
 */
export function LeaderRow({
  label,
  value,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-baseline gap-1.5", className)}>
      <span className="whitespace-nowrap">{label}</span>
      <span
        aria-hidden
        className="flex-1 border-b-[0.5px] border-dashed border-foreground"
      />
      <span className="whitespace-nowrap">{value}</span>
    </div>
  )
}
