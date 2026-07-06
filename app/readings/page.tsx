"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Reading } from "@/lib/types"
import { getReadings, getTankConfig, deleteReading } from "@/lib/actions"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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
import { PaperBox } from "@/components/paper"
import { ReadingForm } from "@/components/reading-form"
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAuthenticated = useAuth()
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [capacity, setCapacity] = useState<number>(1000)

  // The global "Add reading" action in the nav points at /readings?add=1.
  useEffect(() => {
    if (isAuthenticated && searchParams.get("add") === "1") setSheetOpen(true)
  }, [searchParams, isAuthenticated])

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open)
    if (!open && searchParams.get("add") === "1") {
      router.replace(pathname)
    }
  }

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
    return (
      <p className="uppercase text-muted-foreground">Loading…</p>
    )
  }

  return (
    <div>
      <h1 className="sr-only">Entries</h1>
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="px-5 py-6">
          <SheetHeader>
            <SheetTitle className="uppercase">New reading</SheetTitle>
            <SheetDescription>
              Enter the current fuel level from your gauge or dip-stick.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <ReadingForm
              onSuccess={() => {
                handleSheetOpenChange(false)
                loadReadings()
              }}
              onCancel={() => handleSheetOpenChange(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {readings.length === 0 ? (
        <p className="uppercase text-muted-foreground">
          No readings yet. Add your first one to get started.
        </p>
      ) : (
        <PaperBox label="Reading log" contentClassName="p-0 pt-2">
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
                          onClick={() => setDeleteTarget(r.id)}
                          aria-label="Delete reading"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </PaperBox>
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
