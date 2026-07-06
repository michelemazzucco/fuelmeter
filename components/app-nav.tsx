"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"
import { Plus } from "lucide-react"

const links = [
  { href: "/", label: "DASHBOARD" },
  { href: "/readings", label: "ENTRIES" },
  { href: "/settings", label: "SETTINGS" },
]

const actionClass =
  "flex items-center gap-1 bg-primary px-2.5 py-1 uppercase text-primary-foreground"

export function AppNav() {
  const pathname = usePathname()
  const isAuthenticated = useAuth()

  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="mx-auto flex max-w-5xl items-center gap-px px-2">
        <Link href="/" className="py-1 pr-2.5 font-bold tracking-wide">
          FUELMETER
        </Link>
        <nav className="flex items-center gap-px">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-2.5 py-1 tracking-wide transition-colors",
                pathname === link.href ? "bg-muted" : "hover:bg-muted/50"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          {isAuthenticated ? (
            <Link href="/readings?add=1" className={actionClass}>
              <Plus className="h-3.5 w-3.5" />
              Add reading
            </Link>
          ) : (
            pathname !== "/login" && (
              <Link href="/login" className={actionClass}>
                Login
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  )
}
