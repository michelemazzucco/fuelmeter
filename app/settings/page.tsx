"use client"

import { useEffect, useState } from "react"
import type { TankConfig } from "@/lib/types"
import { getTankConfig, saveTankConfig } from "@/lib/actions"
import { PaperBox, LoadingLine } from "@/components/paper"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"

export default function SettingsPage() {
  const isAuthenticated = useAuth()
  const [config, setConfig] = useState<TankConfig | null>(null)
  const [capacity, setCapacity] = useState("")
  const [threshold, setThreshold] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      const data = await getTankConfig()
      if (data) {
        setConfig(data)
        setCapacity(String(data.capacity_liters))
        setThreshold(String(data.low_threshold_liters))
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    const capacityNum = parseFloat(capacity)
    const thresholdNum = parseFloat(threshold)

    if (isNaN(capacityNum) || capacityNum <= 0) {
      setMessage({ type: "error", text: "Capacity must be a positive number." })
      setSaving(false)
      return
    }
    if (isNaN(thresholdNum) || thresholdNum < 0) {
      setMessage({ type: "error", text: "Threshold must be 0 or greater." })
      setSaving(false)
      return
    }

    const { error } = await saveTankConfig({
      id: config?.id,
      capacity_liters: capacityNum,
      low_threshold_liters: thresholdNum,
    })

    if (error) {
      setMessage({ type: "error", text: error })
    } else {
      setMessage({ type: "success", text: "Settings saved." })
    }
    setSaving(false)
  }

  if (loading) {
    return <LoadingLine />
  }

  return (
    <div className="max-w-md">
      <h1 className="sr-only">Settings</h1>
      <PaperBox label="Tank configuration">
        <form onSubmit={handleSave} className="space-y-5">
          <p className="text-muted-foreground uppercase">
            Total capacity and the low-level alert threshold.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="capacity" className="uppercase">
              Tank capacity (litres)
            </Label>
            <Input
              id="capacity"
              type="number"
              min="1"
              step="any"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 1000"
              disabled={!isAuthenticated}
              className="border-[0.5px] bg-transparent tabular-nums disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="threshold" className="uppercase">
              Low-level threshold (litres)
            </Label>
            <Input
              id="threshold"
              type="number"
              min="0"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="e.g. 150"
              disabled={!isAuthenticated}
              className="border-[0.5px] bg-transparent tabular-nums disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground"
            />
            <p className="text-muted-foreground uppercase">
              The gauge turns red below this value.
            </p>
          </div>

          {message && (
            <p
              className={
                message.type === "success"
                  ? "uppercase"
                  : "uppercase text-destructive"
              }
            >
              {message.text}
            </p>
          )}

          {isAuthenticated ? (
            <Button type="submit" disabled={saving} className="uppercase">
              {saving ? "Saving…" : "Save settings"}
            </Button>
          ) : (
            <p className="uppercase text-muted-foreground">Log in to edit settings.</p>
          )}
        </form>
      </PaperBox>
    </div>
  )
}
