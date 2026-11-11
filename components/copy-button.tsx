"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
      }}
      className={cn(
        "shrink-0 border-[0.5px] border-foreground bg-background px-2 py-0.5 leading-[1em] uppercase transition-colors hover:bg-foreground hover:text-background",
        className,
      )}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

export function CopyBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 bg-muted p-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre">{text}</pre>
      <CopyButton text={text} />
    </div>
  )
}
