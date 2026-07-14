"use client"

import { useState } from "react"
import Link from "next/link"
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
  readOnly?: boolean
}

export function ReadingForm({ onSuccess, onCancel, readOnly }: ReadingFormProps) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [levelCm, setLevelCm] = useState("")
  const [isRefill, setIsRefill] = useState(false)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly) return
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
          className="peer sr-only"
        />
        <label
          htmlFor="is-refill"
          aria-hidden
          className="flex size-4 cursor-pointer items-center justify-center bg-muted leading-none text-transparent select-none peer-checked:text-foreground peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground"
        >
          ╳
        </label>
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
        <Button type="submit" className="flex-1" disabled={saving || readOnly}>
          {saving ? "Saving…" : "Add reading"}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {readOnly && (
        <p className="uppercase text-muted-foreground">
          Read-only —{" "}
          <Link href="/login" className="underline underline-offset-2">
            login
          </Link>{" "}
          to save
        </p>
      )}
    </form>
  )
}
