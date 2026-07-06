"use client"

import { useEffect, useState } from "react"
import type { TankConfig } from "@/lib/types"
import { getTankConfig, saveTankConfig } from "@/lib/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export default function SettingsPage() {
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
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Tank Configuration</CardTitle>
          <CardDescription>
            Set your tank's total capacity and the low-level alert threshold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="capacity">Tank capacity (litres)</Label>
              <Input
                id="capacity"
                type="number"
                min="1"
                step="any"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 1000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="threshold">Low-level threshold (litres)</Label>
              <Input
                id="threshold"
                type="number"
                min="0"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="e.g. 150"
              />
              <p className="text-xs text-muted-foreground">
                The gauge turns red when the level drops below this value.
              </p>
            </div>

            {message && (
              <p
                className={
                  message.type === "success" ? "text-sm text-green-600" : "text-sm text-destructive"
                }
              >
                {message.text}
              </p>
            )}

            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
