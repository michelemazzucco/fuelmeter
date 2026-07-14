"use client"

import { Suspense, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MacWindow } from "@/components/mac-window"
import { ReadingForm } from "@/components/reading-form"
import { useAuth } from "@/components/auth-provider"
import { Plus } from "lucide-react"

export const READINGS_CHANGED_EVENT = "fm:readings-changed"

interface AddRecordProps {
  className?: string
}

export function AddRecord(props: AddRecordProps) {
  return (
    <Suspense fallback={null}>
      <AddRecordInner {...props} />
    </Suspense>
  )
}

function AddRecordInner({ className }: AddRecordProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAuthenticated = useAuth()
  const [open, setOpen] = useState(false)

  // Deep links like /readings?add=1 still open the window from any page.
  useEffect(() => {
    if (searchParams.get("add") === "1") setOpen(true)
  }, [searchParams])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen && searchParams.get("add") === "1") {
      router.replace(pathname)
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-label="Add record"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Add record</span>
      </button>
      <MacWindow
        open={open}
        onOpenChange={handleOpenChange}
        title="New reading"
        description="Enter the current fuel level from your gauge or dip-stick."
      >
        <ReadingForm
          readOnly={!isAuthenticated}
          onSuccess={() => {
            handleOpenChange(false)
            window.dispatchEvent(new Event(READINGS_CHANGED_EVENT))
          }}
          onCancel={() => handleOpenChange(false)}
        />
      </MacWindow>
    </>
  )
}
