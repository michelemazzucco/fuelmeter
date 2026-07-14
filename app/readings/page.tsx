"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import type { Reading } from "@/lib/types"
import { getReadings, getTankConfig, deleteReading } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import { READINGS_CHANGED_EVENT } from "@/components/add-record"
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
import { LoadingLine } from "@/components/paper"
import { useAuth } from "@/components/auth-provider"
import { format } from "date-fns"
import { Trash2 } from "lucide-react"

export default function ReadingsPage() {
  return (
    <Suspense fallback={null}>
      <ReadingsPageInner />
    </Suspense>
  )
}

function ReadingsPageInner() {
  const isAuthenticated = useAuth()
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
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

  // Refresh when the global "Add record" window saves a new reading.
  useEffect(() => {
    window.addEventListener(READINGS_CHANGED_EVENT, loadReadings)
    return () => window.removeEventListener(READINGS_CHANGED_EVENT, loadReadings)
  }, [loadReadings])

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteReading(deleteTarget)
    setDeleteTarget(null)
    loadReadings()
  }

  if (loading) {
    return <LoadingLine />
  }

  return (
    <div>
      <h1 className="sr-only">Entries</h1>
      {readings.length === 0 ? (
        <p className="uppercase text-muted-foreground">
          No readings yet. Add your first one to get started.
        </p>
      ) : (
        <Table>
            <TableHeader>
              <TableRow className="border-b-[0.5px] border-foreground hover:bg-transparent">
                <TableHead className="h-8 px-4 uppercase text-foreground">Date</TableHead>
                <TableHead className="h-8 uppercase text-foreground">Level (cm)</TableHead>
                <TableHead className="h-8 uppercase text-foreground">Level (L)</TableHead>
                <TableHead className="h-8 uppercase text-foreground">Notes</TableHead>
                {isAuthenticated && <TableHead className="h-8 w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {readings.map((r) => {
                const pct = r.level_liters != null ? Math.round((r.level_liters / capacity) * 100) : null
                return (
                  <TableRow key={r.id} className="border-b-[0.5px] border-foreground/30">
                    <TableCell className="px-4">
                      <div className="flex items-center gap-2">
                        {format(new Date(r.recorded_at), "dd MMM yyyy")}
                        {r.is_refill && (
                          <span className="border-[0.5px] border-foreground px-1 uppercase">
                            Refill
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.level_cm != null ? `${r.level_cm} cm` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.level_liters != null ? (
                        <span>
                          {r.level_liters} L
                          {pct != null && (
                            <span className="ml-1 text-muted-foreground">({pct}%)</span>
                          )}
                        </span>
                      ) : (
                        <span className="uppercase text-muted-foreground">pending</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.notes ?? "—"}
                    </TableCell>
                    {isAuthenticated && (
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => setDeleteTarget(r.id)}
                          aria-label="Delete reading"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
        </Table>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="uppercase">Delete this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The reading will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="uppercase">Cancel</AlertDialogCancel>
            <AlertDialogAction className="uppercase" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
