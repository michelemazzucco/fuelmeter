"use client"

import { useCallback, useEffect, useState } from "react"
import type { Reading } from "@/lib/types"
import { getReadings, getTankConfig, deleteReading } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ReadingForm } from "@/components/reading-form"
import { useAuth } from "@/components/auth-provider"
import { format } from "date-fns"
import { Plus, Trash2 } from "lucide-react"

export default function ReadingsPage() {
  const isAuthenticated = useAuth()
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [capacity, setCapacity] = useState<number>(1000)

  const loadReadings = useCallback(async () => {
    const [readingsData, configData] = await Promise.all([
      getReadings("desc"),
      getTankConfig(),
    ])
    setReadings(readingsData)
    if (configData) setCapacity(configData.capacity_liters)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadReadings()
  }, [loadReadings])

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteReading(deleteTarget)
    setDeleteTarget(null)
    loadReadings()
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Readings</h1>
        {isAuthenticated && (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger render={<Button />}>
              <Plus className="mr-1 h-4 w-4" />
              Add reading
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>New reading</SheetTitle>
                <SheetDescription>
                  Enter the current fuel level from your gauge or dip-stick.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <ReadingForm
                  onSuccess={() => {
                    setSheetOpen(false)
                    loadReadings()
                  }}
                  onCancel={() => setSheetOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {readings.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No readings yet. Add your first one to get started.
        </p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Level (cm)</TableHead>
                <TableHead>Level (L)</TableHead>
                <TableHead>Notes</TableHead>
                {isAuthenticated && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {readings.map((r) => {
                const pct = r.level_liters != null ? Math.round((r.level_liters / capacity) * 100) : null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        {format(new Date(r.recorded_at), "dd MMM yyyy")}
                        {r.is_refill && <Badge variant="secondary">Refill</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.level_cm != null ? `${r.level_cm} cm` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.level_liters != null ? (
                        <span>
                          {r.level_liters} L
                          {pct != null && (
                            <span className="ml-1 text-muted-foreground">({pct}%)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">pending</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {r.notes ?? "—"}
                    </TableCell>
                    {isAuthenticated && (
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(r.id)}
                          aria-label="Delete reading"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The reading will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
