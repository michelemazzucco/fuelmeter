"use client"

import { useState } from "react"
import { addReading } from "@/lib/actions"
import { cmToLiters } from "@/lib/tank-lookup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { format } from "date-fns"

interface ReadingFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export function ReadingForm({ onSuccess, onCancel }: ReadingFormProps) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [levelCm, setLevelCm] = useState("")
  const [isRefill, setIsRefill] = useState(false)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const cmNum = parseFloat(levelCm)
    if (!isRefill && (isNaN(cmNum) || cmNum <= 0)) {
      setError("Level must be a positive number.")
      return
    }
    const hasCm = !isNaN(cmNum) && cmNum > 0

    setSaving(true)
    try {
      await addReading({
        recorded_at: new Date(date).toISOString(),
        level_cm: hasCm ? cmNum : null,
        level_liters: hasCm ? cmToLiters(cmNum) : null,
        is_refill: isRefill,
        notes: notes.trim() || null,
      })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reading.")
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="date">Date & time</Label>
        <Input
          id="date"
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="is-refill"
          type="checkbox"
          checked={isRefill}
          onChange={(e) => setIsRefill(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <Label htmlFor="is-refill">Tank refill</Label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="level-cm">Level (cm){isRefill && " — optional"}</Label>
        <Input
          id="level-cm"
          type="number"
          min="0"
          step="0.5"
          value={levelCm}
          onChange={(e) => setLevelCm(e.target.value)}
          placeholder="e.g. 55"
          required={!isRefill}
        />
        <p className="text-xs text-muted-foreground">
          {levelCm && !isNaN(parseFloat(levelCm))
            ? `≈ ${cmToLiters(parseFloat(levelCm))} L`
            : isRefill
            ? "Post-refill dip-stick reading, if available."
            : "Dip-stick or gauge reading in centimetres."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isRefill ? "e.g. +990lt delivered" : "e.g. checked before trip"}
          rows={2}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add reading"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
