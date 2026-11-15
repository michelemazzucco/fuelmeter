"use client"

import { useState } from "react"
import { MacWindow } from "@/components/mac-window"
import { SettingsForm } from "@/components/settings-form"

export function SettingsWindow({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        SETTINGS
      </button>
      <MacWindow
        open={open}
        onOpenChange={setOpen}
        title="Settings"
        description="Total capacity and the low-level alert threshold."
      >
        <SettingsForm onSaved={() => setOpen(false)} />
      </MacWindow>
    </>
  )
}
